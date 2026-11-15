using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

// Independent of UTrustNtag216RfidWrite: no change to the formal writer's byte logic.
public static class UTrustNtag216EraseInitial
{
    private const string WriterVersion = "ntag216-initial-erase-v1";
    private const string Confirmation = "ERASE_NTAG216_USER_AREA";
    private const int FirstUserPage = 4;
    private const int LastUserPage = 225;
    private const int DynamicLockPage = 226;
    // NXP NTAG213_215_216 Rev. 3.2, sections 8.5.3-8.5.7 and table 28:
    // CC 6Dh declares 872 NDEF bytes, NOT the physical user-memory boundary.
    // Only exact GET_VERSION 00 04 04 02 01 00 13 03 selects the 888-byte
    // NTAG216 profile (pages 04h..E1h); E2h is dynamic lock, E3h..E6h config.
    // https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf
    private static readonly byte[] Ntag216Version = { 0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x13, 0x03 };
    private static readonly int[] ReadOnlyPages = { 0, 1, 2, 3, 226, 227, 228 };
    private static readonly byte[] ZeroPage = { 0x00, 0x00, 0x00, 0x00 };
    private static readonly byte[] InitialPage = { 0x03, 0x00, 0xFE, 0x00 };

    private sealed class Progress
    {
        public string Stage = "prepare";
        public string Fingerprint = "";
        public int FailedPage = -1;
        public int PagesWritten;
        public bool WriteAttempted;
        public bool ProtectionChanged;
    }
    private static string Escape(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }
    private static string Bool(bool value) { return value ? "true" : "false"; }
    private static string Error(int value) { return string.Format("0x{0:X8}", unchecked((uint)value)); }
    private static string Fingerprint(byte[] uid)
    {
        string canonicalUid = BitConverter.ToString(uid).Replace("-", "");
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes("road-rfid-card:v1:" + canonicalUid))).Replace("-", "").ToLowerInvariant();
    }
    private static void Authorize(string confirm, string expected)
    {
        if (!string.Equals(confirm, Confirmation, StringComparison.Ordinal)) throw new InvalidOperationException("erase_confirmation_required");
        if (expected == null || expected.Length != 64 || expected.Any(c => !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))))
            throw new InvalidOperationException("expected_uid_fingerprint_invalid");
    }
    private static byte[] Transmit(Func<byte[], byte[]> exchange, byte[] command, string operation)
    {
        byte[] response = exchange(command);
        if (response == null || response.Length < 2 || response.Length > 258) throw new InvalidOperationException(operation + "_response_length_invalid");
        int length = response.Length;
        if (response[length - 2] != 0x90 || response[length - 1] != 0x00)
            throw new InvalidOperationException(operation + "_status_" + string.Format("{0:X2}{1:X2}", response[length - 2], response[length - 1]));
        return response.Take(length - 2).ToArray();
    }
    private static byte[] ReadUid(Func<byte[], byte[]> exchange)
    {
        byte[] uid = Transmit(exchange, new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 }, "get_uid");
        if (uid.Length != 7 || uid[0] != 0x04) throw new InvalidOperationException("ntag216_uid_invalid");
        return uid;
    }
    private static void RequireUid(Func<byte[], byte[]> exchange, byte[] expected)
    {
        if (!expected.SequenceEqual(ReadUid(exchange))) throw new InvalidOperationException("card_uid_changed");
    }
    private static byte[] ReadPage(Func<byte[], byte[]> exchange, int page)
    {
        if (page < 0 || page > 228) throw new InvalidOperationException("read_page_out_of_supported_range");
        byte[] data = Transmit(exchange, new byte[] { 0xFF, 0xB0, 0x00, (byte)page, 0x04 }, "read_page_" + page);
        if (data.Length != 4) throw new InvalidOperationException("read_page_" + page + "_length_invalid");
        return data;
    }
    private static void RequirePage(Func<byte[], byte[]> exchange, byte[] uid, int page, byte[] expected, Progress progress)
    {
        progress.FailedPage = page;
        RequireUid(exchange, uid);
        if (!expected.SequenceEqual(ReadPage(exchange, page))) throw new InvalidOperationException("post_write_byte_mismatch_page_" + page);
        RequireUid(exchange, uid);
    }
    private static void WriteUserPage(Func<byte[], byte[]> exchange, byte[] uid, int page, byte[] data, Progress progress)
    {
        // The only write-command constructor. Never allow CC/manufacturer/locks/config.
        if (page < FirstUserPage || page > LastUserPage || data == null || data.Length != 4)
            throw new InvalidOperationException("write_outside_ntag216_user_area");
        progress.FailedPage = page;
        RequireUid(exchange, uid);
        progress.WriteAttempted = true; // Failed APDU may already have changed memory.
        byte[] result = Transmit(exchange, new byte[] { 0xFF, 0xD6, 0x00, (byte)page, 0x04, data[0], data[1], data[2], data[3] }, "write_page_" + page);
        if (result.Length != 0) throw new InvalidOperationException("write_page_" + page + "_response_length_invalid");
        progress.PagesWritten++;
        RequirePage(exchange, uid, page, data, progress);
    }
    private static byte[][] Snapshot(Func<byte[], byte[]> exchange)
    {
        return ReadOnlyPages.Select(page => ReadPage(exchange, page)).ToArray();
    }
    private static void RequireSnapshot(Func<byte[], byte[]> exchange, byte[][] original, Progress progress)
    {
        for (int index = 0; index < ReadOnlyPages.Length; index++)
        {
            if (!original[index].SequenceEqual(ReadPage(exchange, ReadOnlyPages[index])))
            {
                progress.ProtectionChanged = true;
                throw new InvalidOperationException("read_only_page_changed_" + ReadOnlyPages[index]);
            }
        }
    }
    private static void RequireCapability(byte[] cc)
    {
        if (cc[0] != 0xE1 || cc[1] != 0x10 || cc[2] != 0x6D) throw new InvalidOperationException("ntag216_cc_capacity_not_supported");
        if (cc[3] != 0x00) throw new InvalidOperationException("card_write_protected_cc");
    }
    private static void RequireProtectionAndIdentity(byte[][] pages, byte[] uid)
    {
        byte[] manufacturerUid = pages[0].Take(3).Concat(pages[1]).ToArray();
        if (!uid.SequenceEqual(manufacturerUid) || pages[0][3] != (byte)(0x88 ^ uid[0] ^ uid[1] ^ uid[2]) ||
            pages[2][0] != (byte)(uid[3] ^ uid[4] ^ uid[5] ^ uid[6])) throw new InvalidOperationException("manufacturer_uid_mismatch");
        // Conservative profile: even block-lock-only bits cause refusal. We never
        // unlock or authenticate a protected tag (nor write PWD/PACK/config pages).
        if (pages[2][2] != 0 || pages[2][3] != 0) throw new InvalidOperationException("card_write_protected_static_lock");
        if (pages[4].Take(3).Any(value => value != 0)) throw new InvalidOperationException("card_write_protected_dynamic_lock");
        if (pages[4][3] != 0xBD) throw new InvalidOperationException("ntag216_dynamic_lock_profile_unknown");
        if (pages[5][3] != 0xFF || (pages[6][0] & 0xC0) != 0) throw new InvalidOperationException("card_write_protected_configuration");
        // Mirroring overlays reads and cannot be disabled without touching config.
        if ((pages[5][0] & 0xC0) != 0) throw new InvalidOperationException("card_ascii_mirror_enabled");
    }
    private static void Report(Progress progress, bool success, string result)
    {
        Console.WriteLine("{\"success\":" + Bool(success) + ",\"erased\":" + Bool(success) + ",\"verified\":" + Bool(success) +
            ",\"initialNdef\":" + Bool(success) + ",\"writeProtectionChanged\":" + Bool(progress.ProtectionChanged) +
            ",\"cardUidFingerprint\":\"" + Escape(progress.Fingerprint) + "\",\"writerVersion\":\"" + WriterVersion +
            "\",\"stage\":\"" + Escape(progress.Stage) + "\",\"result\":\"" + Escape(result) +
            "\",\"writeAttempted\":" + Bool(progress.WriteAttempted) + ",\"pagesWritten\":" + progress.PagesWritten +
            ",\"failedPage\":" + progress.FailedPage + ",\"ndefCapacityBytes\":872,\"physicalUserBytes\":888}");
    }
    // Test seam accepts raw APDU responses INCLUDING SW1/SW2. The same validation
    // and write algorithm is used in production; no environment fake/test mode.
    public static int Erase(Func<byte[], byte[]> exchange, string confirm, string expectedFingerprint)
    {
        Progress progress = new Progress();
        try
        {
            Authorize(confirm, expectedFingerprint);
            if (exchange == null) throw new InvalidOperationException("apdu_transport_required");
            progress.Stage = "identify_card";
            byte[] uid = ReadUid(exchange);
            progress.Fingerprint = Fingerprint(uid);
            if (!string.Equals(progress.Fingerprint, expectedFingerprint, StringComparison.Ordinal)) throw new InvalidOperationException("card_uid_fingerprint_mismatch");
            // Identiv uTrust 47xx manual 6.2.11: FF EF, P1=01 discards CRC.
            // GET_VERSION is read-only. Unsupported firmware/status/length fails closed.
            byte[] version = Transmit(exchange, new byte[] { 0xFF, 0xEF, 0x01, 0x00, 0x01, 0x60 }, "get_version");
            if (!Ntag216Version.SequenceEqual(version)) throw new InvalidOperationException("card_type_not_ntag216");
            RequireUid(exchange, uid);
            progress.Stage = "capability_container";
            RequireCapability(ReadPage(exchange, 3));
            progress.Stage = "check_write_protection";
            byte[][] original = Snapshot(exchange);
            RequireCapability(original[3]);
            RequireProtectionAndIdentity(original, uid);
            RequireUid(exchange, uid);
            progress.Stage = "preflight_user_area";
            for (int page = FirstUserPage; page <= LastUserPage; page++)
            {
                progress.FailedPage = page;
                ReadPage(exchange, page); // Detect unreadable/short tail before ANY write.
            }
            RequireUid(exchange, uid);
            RequireSnapshot(exchange, original, progress);

            // Invalidate first, clear and verify the WHOLE physical area, then
            // commit 03 00 FE 00 only after every zero page has been read back.
            progress.Stage = "invalidate_ndef";
            WriteUserPage(exchange, uid, FirstUserPage, ZeroPage, progress);
            progress.Stage = "clear_user_area";
            for (int page = FirstUserPage + 1; page <= LastUserPage; page++) WriteUserPage(exchange, uid, page, ZeroPage, progress);
            progress.Stage = "verify_zero_user_area";
            for (int page = FirstUserPage; page <= LastUserPage; page++) RequirePage(exchange, uid, page, ZeroPage, progress);
            RequireSnapshot(exchange, original, progress);
            progress.Stage = "commit_initial_ndef";
            WriteUserPage(exchange, uid, FirstUserPage, InitialPage, progress);
            progress.Stage = "verify_initial_user_area";
            for (int page = FirstUserPage; page <= LastUserPage; page++) RequirePage(exchange, uid, page, page == FirstUserPage ? InitialPage : ZeroPage, progress);
            RequireUid(exchange, uid);
            RequireSnapshot(exchange, original, progress);
            RequireUid(exchange, uid);
            progress.Stage = "complete";
            progress.FailedPage = -1;
            Report(progress, true, "initial_card_restored");
            return 0;
        }
        catch (Exception ex)
        {
            // Never retry/reconnect or claim success after partial erase/failure.
            Report(progress, false, ex.Message);
            return 1;
        }
    }
    public static int Main()
    {
        using (PcscSession session = new PcscSession())
        {
            return Erase(session.Exchange, Environment.GetEnvironmentVariable("RC_RFID_ERASE_CONFIRM"),
                Environment.GetEnvironmentVariable("RC_RFID_EXPECTED_UID_FINGERPRINT"));
        }
    }

    private sealed class PcscSession : IDisposable
    {
        private IntPtr context = IntPtr.Zero;
        private IntPtr card = IntPtr.Zero;
        private IoRequest request;
        private bool transaction;
        [StructLayout(LayoutKind.Sequential)] private struct IoRequest { public uint Protocol; public uint PciLength; }
        [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardEstablishContext(uint scope, IntPtr a, IntPtr b, out IntPtr context);
        [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, IntPtr readers, ref uint length);
        [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, [Out] char[] readers, ref uint length);
        [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardConnect(IntPtr context, string reader, uint share, uint protocols, out IntPtr card, out uint protocol);
        [DllImport("winscard.dll")] private static extern int SCardBeginTransaction(IntPtr card);
        [DllImport("winscard.dll")] private static extern int SCardEndTransaction(IntPtr card, uint disposition);
        [DllImport("winscard.dll")] private static extern int SCardTransmit(IntPtr card, ref IoRequest request, byte[] send, int length, IntPtr receiveRequest, byte[] receive, ref int receiveLength);
        [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, uint disposition);
        [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr context);
        private void Connect()
        {
            int rc = SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out context);
            if (rc != 0) throw new InvalidOperationException("establish_context_" + Error(rc));
            uint length = 0;
            rc = SCardListReaders(context, null, IntPtr.Zero, ref length);
            if (rc != 0) throw new InvalidOperationException("list_readers_" + Error(rc));
            if (length == 0) throw new InvalidOperationException("utrust_cl_reader_not_found");
            char[] readers = new char[length];
            rc = SCardListReaders(context, null, readers, ref length);
            if (rc != 0) throw new InvalidOperationException("list_readers_" + Error(rc));
            string[] matches = new string(readers).Split('\0').Where(name => name.IndexOf("4701 F CL Reader", StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
            if (matches.Length != 1) throw new InvalidOperationException("utrust_cl_reader_not_unique");
            uint protocol;
            // Exclusive handle plus a PC/SC transaction. Never reconnect a removed
            // or reset card: its transport error terminates this operation.
            rc = SCardConnect(context, matches[0], 1, 3, out card, out protocol);
            if (rc != 0) throw new InvalidOperationException("connect_" + Error(rc));
            rc = SCardBeginTransaction(card);
            if (rc != 0) throw new InvalidOperationException("begin_transaction_" + Error(rc));
            transaction = true;
            request = new IoRequest { Protocol = protocol, PciLength = (uint)Marshal.SizeOf(typeof(IoRequest)) };
        }
        public byte[] Exchange(byte[] command)
        {
            // Lazy connect ensures missing confirmation/fingerprint never touches
            // even the reader, and Main() fails safely on non-Windows as well.
            if (card == IntPtr.Zero) Connect();
            byte[] response = new byte[258]; int length = response.Length;
            int rc = SCardTransmit(card, ref request, command, command.Length, IntPtr.Zero, response, ref length);
            if (rc != 0) throw new InvalidOperationException("apdu_transport_" + Error(rc));
            if (length < 0 || length > response.Length) throw new InvalidOperationException("apdu_transport_response_length_invalid");
            return response.Take(length).ToArray();
        }
        public void Dispose()
        {
            // LEAVE_CARD: no reset, unlock, or card configuration alteration.
            if (card != IntPtr.Zero)
            {
                if (transaction) SCardEndTransaction(card, 0);
                SCardDisconnect(card, 0);
            }
            if (context != IntPtr.Zero) SCardReleaseContext(context);
        }
    }
}
