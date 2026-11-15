using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

// No winscard.dll import/use: raw response fake for the production Erase() seam.
public static class UTrustNtag216EraseInitialFake
{
    private static readonly byte[] Uid = { 0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6 };
    private sealed class FakeCard
    {
        public readonly byte[][] Memory = Enumerable.Range(0, 231).Select(_ => new byte[4]).ToArray();
        public readonly int[] ReadCounts = new int[231];
        public readonly List<int> Writes = new List<int>();
        public readonly List<string> WriteData = new List<string>();
        public readonly List<int> Reads = new List<int>();
        public int Calls;
        public int UidReads;
        public int VersionReads;
        public readonly string Scenario;
        public FakeCard(string scenario)
        {
            Scenario = scenario;
            Memory[0] = new byte[] { Uid[0], Uid[1], Uid[2], (byte)(0x88 ^ Uid[0] ^ Uid[1] ^ Uid[2]) };
            Memory[1] = Uid.Skip(3).ToArray();
            Memory[2][0] = (byte)(Uid[3] ^ Uid[4] ^ Uid[5] ^ Uid[6]);
            Memory[2][1] = 0x48;
            Memory[3] = new byte[] { 0xE1, 0x10, 0x6D, 0x00 };
            for (int page = 4; page <= 225; page++) Memory[page] = new byte[] { 0xA5, 0x5A, 0xB6, (byte)page };
            Memory[226][3] = 0xBD;
            Memory[227] = new byte[] { 0x04, 0x00, 0x00, 0xFF };
            // PWD/PACK are inaccessible to the tested algorithm and must stay intact.
            Memory[229] = new byte[] { 0xFF, 0xFF, 0xFF, 0xFF };
            Memory[230] = new byte[] { 0x12, 0x34, 0x00, 0x00 };
            if (scenario == "unknown_cc") Memory[3][2] = 0x6E;
            if (scenario == "small_cc") Memory[3][2] = 0x3E;
            if (scenario == "cc_write_protected") Memory[3][3] = 0x0F;
            if (scenario == "cc_read_protected") Memory[3][3] = 0xF0;
            if (scenario == "static_lock") Memory[2][2] = 0x10;
            if (scenario == "static_block_lock") Memory[2][2] = 0x01;
            if (scenario == "dynamic_lock") Memory[226][1] = 0x20; // protects pages 224..225
            if (scenario == "dynamic_block_lock") Memory[226][2] = 0x40;
            if (scenario == "unknown_dynamic_profile") Memory[226][3] = 0;
            if (scenario == "password_protected") Memory[227][3] = 225;
            if (scenario == "config_only_password") Memory[227][3] = 227;
            if (scenario == "config_locked") Memory[228][0] = 0x40;
            if (scenario == "read_protected") Memory[228][0] = 0x80;
            if (scenario == "mirror") Memory[227][0] |= 0x40;
            if (scenario == "manufacturer_mismatch") Memory[0][1] ^= 1;
            if (scenario == "bcc_mismatch") Memory[0][3] ^= 1;
        }
        private byte[] Ok(byte[] data) { return data.Concat(new byte[] { 0x90, 0x00 }).ToArray(); }
        private byte[] StatusFail() { return new byte[] { 0x69, 0x82 }; }
        public byte[] Exchange(byte[] command)
        {
            Calls++;
            if (command.SequenceEqual(new byte[] { 0xFF, 0xCA, 0, 0, 0 }))
            {
                UidReads++;
                if (Scenario == "short_uid") return Ok(Uid.Take(4).ToArray());
                if (Scenario == "uid_status_fail") return StatusFail();
                bool changed = (Scenario == "uid_changed_prewrite" && ReadCounts[228] >= 2) ||
                    (Scenario == "uid_changed_after_first_write" && Writes.Count >= 1) ||
                    (Scenario == "uid_changed_mid_erase" && Writes.Count >= 50) ||
                    (Scenario == "uid_changed_before_commit" && ReadCounts[225] >= 3) ||
                    (Scenario == "uid_changed_final" && Writes.Count >= 223);
                byte[] value = (byte[])Uid.Clone();
                if (changed) value[6] ^= 1;
                return Ok(value);
            }
            if (command.SequenceEqual(new byte[] { 0xFF, 0xEF, 1, 0, 1, 0x60 }))
            {
                VersionReads++;
                if (Scenario == "version_status_fail") return StatusFail();
                if (Scenario == "version_transport_fail") throw new InvalidOperationException("apdu_transport_0x80100068");
                byte[] version = { 0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x13, 0x03 };
                if (Scenario == "ntag213") version[6] = 0x0F;
                if (Scenario == "ntag215") version[6] = 0x11;
                if (Scenario == "unknown_version") version[5] = 0x01;
                if (Scenario == "short_version") return Ok(version.Take(7).ToArray());
                return Ok(version);
            }
            if (command.Length == 5 && command[0] == 0xFF && command[1] == 0xB0 && command[2] == 0 && command[4] == 4)
            {
                int page = command[3];
                Reads.Add(page); ReadCounts[page]++;
                if (Scenario == "tail_read_fail" && page == 225) return StatusFail();
                if (Scenario == "protection_read_fail" && page == 226) return StatusFail();
                if (Scenario == "short_page" && page == 224) return Ok(new byte[] { 0, 0, 0 });
                // Dirty after immediate readback: final complete scan must catch it.
                if (Scenario == "final_tail_dirty" && page == 225 && Writes.Count == 223) Memory[225][3] = 0x7B;
                if (Scenario == "zero_scan_tail_dirty" && page == 225 && ReadCounts[page] == 3) Memory[225][3] = 0x7B;
                if (Scenario == "lock_changed" && page == 226 && Writes.Count == 223) Memory[226][0] = 0x01;
                return Ok((byte[])Memory[page].Clone());
            }
            if (command.Length == 9 && command[0] == 0xFF && command[1] == 0xD6 && command[2] == 0 && command[4] == 4)
            {
                int page = command[3];
                Writes.Add(page); WriteData.Add(BitConverter.ToString(command.Skip(5).ToArray()).Replace("-", ""));
                // Hard guard in fake in addition to production guard; a regression
                // targeting a lock/config/manufacturer page fails the real run.
                if (page < 4 || page > 225) throw new InvalidOperationException("TEST_UNSAFE_WRITE_PAGE_" + page);
                if (Scenario == "write_fail" && page == 6) return StatusFail();
                if (Scenario == "first_write_fail" && page == 4) return StatusFail();
                if (Scenario == "tail_write_fail" && page == 225) return StatusFail();
                if (Scenario == "write_transport_fail" && page == 6) throw new InvalidOperationException("apdu_transport_0x80100069");
                if (!(Scenario == "tail_not_zero" && page == 225)) Memory[page] = command.Skip(5).ToArray();
                if (Scenario == "unexpected_write_response" && page == 4) return Ok(new byte[] { 0x0A });
                return Ok(new byte[0]);
            }
            throw new InvalidOperationException("TEST_UNEXPECTED_APDU_" + BitConverter.ToString(command));
        }
    }
    private static string Fingerprint()
    {
        using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes("road-rfid-card:v1:04A1B2C3D4E5F6"))).Replace("-", "").ToLowerInvariant();
    }
    public static int Main(string[] args)
    {
        string scenario = args.Length == 0 ? "success" : args[0];
        if (scenario == "main_missing_confirmation")
        {
            Environment.SetEnvironmentVariable("RC_RFID_ERASE_CONFIRM", null);
            Environment.SetEnvironmentVariable("RC_RFID_EXPECTED_UID_FINGERPRINT", Fingerprint());
            return UTrustNtag216EraseInitial.Main(); // No PC/SC calls: runnable on Linux.
        }
        FakeCard card = new FakeCard(scenario);
        byte[][] original = card.Memory.Select(page => (byte[])page.Clone()).ToArray();
        string confirm = scenario == "missing_confirmation" ? null : scenario == "wrong_confirmation" ? "erase_ntag216_user_area" : "ERASE_NTAG216_USER_AREA";
        string expected = scenario == "missing_uid" ? null : scenario == "wrong_uid" ? new string('0', 64) : scenario == "uppercase_fingerprint" ? Fingerprint().ToUpperInvariant() : Fingerprint();
        int exitCode = UTrustNtag216EraseInitial.Erase(card.Exchange, confirm, expected);
        bool preserved = Enumerable.Range(0, 231).Where(page => page < 4 || page > 225).All(page => original[page].SequenceEqual(card.Memory[page]));
        string memory = BitConverter.ToString(card.Memory.Skip(4).Take(222).SelectMany(page => page).ToArray()).Replace("-", "");
        Console.WriteLine("{\"harness\":true,\"exitCode\":" + exitCode + ",\"calls\":" + card.Calls + ",\"uidReads\":" + card.UidReads + ",\"versionReads\":" + card.VersionReads +
            ",\"writes\":[" + string.Join(",", card.Writes.Select(page => page.ToString()).ToArray()) + "],\"writeData\":[" + string.Join(",", card.WriteData.Select(data => "\"" + data + "\"").ToArray()) +
            "],\"reads\":[" + string.Join(",", card.Reads.Select(page => page.ToString()).ToArray()) + "],\"readCounts\":[" + string.Join(",", card.ReadCounts.Select(count => count.ToString()).ToArray()) +
            "],\"protectedPagesPreserved\":" + (preserved ? "true" : "false") + ",\"memory\":\"" + memory + "\"}");
        return 0;
    }
}
