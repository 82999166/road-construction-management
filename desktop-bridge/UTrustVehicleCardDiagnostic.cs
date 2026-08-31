using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public static class UTrustVehicleCardDiagnostic
{
    private const uint ScopeSystem = 2;
    private const uint ShareShared = 2;
    private const uint ProtocolT0OrT1 = 3;
    private const uint LeaveCard = 0;
    [StructLayout(LayoutKind.Sequential)] private struct IoRequest { public uint Protocol; public uint PciLength; }
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardEstablishContext(uint scope, IntPtr a, IntPtr b, out IntPtr context);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, IntPtr readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, [Out] char[] readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardConnect(IntPtr context, string reader, uint share, uint protocol, out IntPtr card, out uint activeProtocol);
    [DllImport("winscard.dll")] private static extern int SCardTransmit(IntPtr card, ref IoRequest request, byte[] send, int sendLength, IntPtr recvRequest, byte[] recv, ref int recvLength);
    [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, uint disposition);
    [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr context);

    private static string Error(int value) { return string.Format("0x{0:X8}", unchecked((uint)value)); }
    private static string Escape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
    private static string Sha256(byte[] value) { using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); }
    private static byte[] Transmit(IntPtr card, ref IoRequest request, byte[] command, string operation)
    {
        byte[] response = new byte[258]; int length = response.Length;
        int rc = SCardTransmit(card, ref request, command, command.Length, IntPtr.Zero, response, ref length);
        if (rc != 0) throw new InvalidOperationException(operation + "_transport_" + Error(rc));
        if (length < 2) throw new InvalidOperationException(operation + "_response_too_short");
        if (response[length - 2] != 0x90 || response[length - 1] != 0x00) throw new InvalidOperationException(operation + "_status_" + string.Format("{0:X2}{1:X2}", response[length - 2], response[length - 1]));
        return response.Take(length - 2).ToArray();
    }
    private static byte[] ReadPage(IntPtr card, ref IoRequest request, int page) { return Transmit(card, ref request, new byte[] { 0xFF, 0xB0, 0x00, (byte)page, 0x04 }, "read_page_" + page); }
    private static string FingerprintUid(byte[] uid) { return Sha256(Encoding.UTF8.GetBytes("road-rfid-card:v1:" + BitConverter.ToString(uid).Replace("-", ""))); }
    private static string Hex(byte[] value) { return BitConverter.ToString(value ?? new byte[0]).Replace("-", ""); }
    private static string SafeReadStatus(string message)
    {
        string value = message ?? "";
        int statusIndex = value.LastIndexOf("_status_", StringComparison.Ordinal);
        if (statusIndex >= 0 && statusIndex + 8 <= value.Length) return "status_" + value.Substring(statusIndex + 8);
        if (value.IndexOf("_transport_", StringComparison.Ordinal) >= 0) return "transport_failed";
        return "read_failed";
    }
    private static bool TryReadPage(IntPtr card, ref IoRequest request, int page, out byte[] data, out string status)
    {
        try { data = ReadPage(card, ref request, page); status = "ok"; return data.Length == 4; }
        catch (Exception ex) { data = new byte[0]; status = SafeReadStatus(ex.Message); return false; }
    }
    private static int ReadTlvLength(byte[] bytes, ref int position)
    {
        if (position >= bytes.Length) throw new InvalidOperationException("ndef_tlv_length_missing");
        int value = bytes[position++];
        if (value != 0xFF) return value;
        if (position + 1 >= bytes.Length) throw new InvalidOperationException("ndef_tlv_extended_length_missing");
        return (bytes[position++] << 8) | bytes[position++];
    }
    private static string InspectNdef(byte[] bytes)
    {
        int position = 0; while (position < bytes.Length && bytes[position] == 0x00) position++;
        if (position >= bytes.Length) return "empty";
        if (bytes[position++] != 0x03) return "ndef_tlv_missing";
        int ndefLength = ReadTlvLength(bytes, ref position);
        if (ndefLength <= 0 || position + ndefLength > bytes.Length) return "ndef_tlv_length_invalid";
        int end = position + ndefLength; int records = 0; bool uri = false; bool text = false; bool rc3 = false;
        while (position < end)
        {
            byte header = bytes[position++]; if (position + 2 > end) return "ndef_record_header_invalid";
            bool shortRecord = (header & 0x10) != 0; bool idPresent = (header & 0x08) != 0;
            int typeLength = bytes[position++]; int payloadLength;
            if (shortRecord) { payloadLength = bytes[position++]; } else { if (position + 4 > end) return "ndef_record_length_invalid"; payloadLength = (bytes[position++] << 24) | (bytes[position++] << 16) | (bytes[position++] << 8) | bytes[position++]; }
            int idLength = idPresent ? (position < end ? bytes[position++] : -1) : 0;
            if (idLength < 0 || position + typeLength + idLength + payloadLength > end) return "ndef_record_bounds_invalid";
            byte recordType = typeLength == 1 ? bytes[position] : (byte)0x00;
            position += typeLength + idLength;
            if (recordType == 0x55) uri = true;
            if (recordType == 0x54) { text = true; int languageLength = payloadLength > 0 ? bytes[position] & 0x3F : 0; if (payloadLength > languageLength + 1) { string content = Encoding.UTF8.GetString(bytes, position + 1 + languageLength, payloadLength - 1 - languageLength); rc3 = content.StartsWith("{\"t\":\"RC3\""); } }
            position += payloadLength; records++;
        }
        return "ok:records=" + records + ";uri=" + (uri ? "1" : "0") + ";text=" + (text ? "1" : "0") + ";rc3=" + (rc3 ? "1" : "0");
    }
    private static string InspectTlv(byte[] bytes, out int tlvOffset, out int lengthFieldBytes, out int declaredLength, out int availableBytes, out bool terminatorPresent)
    {
        int position = 0;
        while (position < bytes.Length && bytes[position] == 0x00) position++;
        tlvOffset = position < bytes.Length ? position : -1;
        lengthFieldBytes = 0;
        declaredLength = -1;
        availableBytes = 0;
        terminatorPresent = false;
        if (position >= bytes.Length) return "empty";
        if (bytes[position++] != 0x03) return "ndef_tlv_missing";
        int lengthStart = position;
        try { declaredLength = ReadTlvLength(bytes, ref position); }
        catch { return "ndef_tlv_length_missing"; }
        lengthFieldBytes = position - lengthStart;
        availableBytes = bytes.Length - position;
        if (declaredLength <= 0 || declaredLength > availableBytes) return "ndef_tlv_length_invalid";
        int terminatorIndex = position + declaredLength;
        terminatorPresent = terminatorIndex < bytes.Length && bytes[terminatorIndex] == 0xFE;
        return InspectNdef(bytes);
    }
    private static int CountContiguousNonZeroPages(byte[] bytes)
    {
        int pages = bytes.Length / 4;
        int count = 0;
        for (int page = 0; page < pages; page++)
        {
            bool nonZero = false;
            for (int offset = 0; offset < 4; offset++) if (bytes[page * 4 + offset] != 0x00) { nonZero = true; break; }
            if (!nonZero) break;
            count++;
        }
        return count;
    }
    private static int LastNonZeroUserPage(byte[] bytes)
    {
        for (int index = bytes.Length - 1; index >= 0; index--) if (bytes[index] != 0x00) return 4 + (index / 4);
        return -1;
    }
    public static int Main()
    {
        IntPtr context = IntPtr.Zero; IntPtr card = IntPtr.Zero;
        try
        {
            int rc = SCardEstablishContext(ScopeSystem, IntPtr.Zero, IntPtr.Zero, out context); if (rc != 0) throw new InvalidOperationException("context_" + Error(rc));
            uint count = 0; rc = SCardListReaders(context, null, IntPtr.Zero, ref count); if (rc != 0) throw new InvalidOperationException("readers_" + Error(rc));
            char[] readers = new char[count]; rc = SCardListReaders(context, null, readers, ref count); if (rc != 0) throw new InvalidOperationException("readers_" + Error(rc));
            string reader = new string(readers).Split('\0').FirstOrDefault(name => name.IndexOf("4701 F CL Reader", StringComparison.OrdinalIgnoreCase) >= 0); if (string.IsNullOrWhiteSpace(reader)) throw new InvalidOperationException("utrust_cl_reader_not_found");
            uint protocol; rc = SCardConnect(context, reader, ShareShared, ProtocolT0OrT1, out card, out protocol); if (rc != 0) throw new InvalidOperationException("connect_" + Error(rc));
            IoRequest request = new IoRequest { Protocol = protocol, PciLength = (uint)Marshal.SizeOf(typeof(IoRequest)) };
            byte[] uid = Transmit(card, ref request, new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 }, "get_uid");
            byte[] cc = ReadPage(card, ref request, 3);
            if (cc.Length != 4 || cc[0] != 0xE1 || cc[1] != 0x10 || cc[2] == 0x00) throw new InvalidOperationException("ntag_type2_ndef_cc_not_detected");
            int capacity = cc[2] * 8; int pages = (capacity + 3) / 4;
            if (4 + pages > 0x100) throw new InvalidOperationException("ntag_ndef_user_area_out_of_range");
            List<byte> memory = new List<byte>(); for (int index = 0; index < pages; index++) memory.AddRange(ReadPage(card, ref request, 4 + index));
            byte[] memoryBytes = memory.ToArray();
            int tlvOffset; int lengthFieldBytes; int declaredLength; int availableBytes; bool terminatorPresent;
            string ndefStructure = InspectTlv(memoryBytes, out tlvOffset, out lengthFieldBytes, out declaredLength, out availableBytes, out terminatorPresent);
            int contiguousNonZeroPages = CountContiguousNonZeroPages(memoryBytes);
            int firstAllZeroPage = contiguousNonZeroPages < pages ? 4 + contiguousNonZeroPages : -1;
            byte[] staticPage; byte[] dynamicLockPage; byte[] config0Page; byte[] config1Page;
            string staticStatus; string dynamicStatus; string config0Status; string config1Status;
            bool staticReadable = TryReadPage(card, ref request, 2, out staticPage, out staticStatus);
            bool dynamicReadable = TryReadPage(card, ref request, 0xE2, out dynamicLockPage, out dynamicStatus);
            bool config0Readable = TryReadPage(card, ref request, 0xE3, out config0Page, out config0Status);
            bool config1Readable = TryReadPage(card, ref request, 0xE4, out config1Page, out config1Status);
            string staticLock = staticReadable ? Hex(staticPage.Skip(2).Take(2).ToArray()) : "unreadable";
            string dynamicLock = dynamicReadable ? Hex(dynamicLockPage.Take(3).ToArray()) : "unreadable";
            string auth0 = config0Readable ? string.Format("{0:X2}", config0Page[3]) : "unreadable";
            bool readProtection = config1Readable && (config1Page[0] & 0x80) != 0;
            bool configLocked = config1Readable && (config1Page[0] & 0x40) != 0;
            Console.WriteLine("{\"success\":true,\"operation\":\"read_only_vehicle_card_diagnostic\",\"reader\":\"" + Escape(reader) + "\",\"uidFingerprint\":\"" + FingerprintUid(uid) + "\",\"cc\":\"" + Hex(cc) + "\",\"ndefCapacityBytes\":" + capacity + ",\"pagesRead\":" + pages + ",\"ndefStructure\":\"" + Escape(ndefStructure) + "\",\"tlvOffset\":" + tlvOffset + ",\"tlvLengthFieldBytes\":" + lengthFieldBytes + ",\"tlvDeclaredLength\":" + declaredLength + ",\"tlvAvailableBytes\":" + availableBytes + ",\"tlvTerminatorPresent\":" + (terminatorPresent ? "true" : "false") + ",\"contiguousNonZeroPages\":" + contiguousNonZeroPages + ",\"firstAllZeroUserPage\":" + firstAllZeroPage + ",\"lastNonZeroUserPage\":" + LastNonZeroUserPage(memoryBytes) + ",\"staticLock\":\"" + staticLock + "\",\"staticLockRead\":\"" + staticStatus + "\",\"dynamicLock\":\"" + dynamicLock + "\",\"dynamicLockRead\":\"" + dynamicStatus + "\",\"auth0\":\"" + auth0 + "\",\"config0Read\":\"" + config0Status + "\",\"config1Read\":\"" + config1Status + "\",\"readProtection\":" + (readProtection ? "true" : "false") + ",\"configLocked\":" + (configLocked ? "true" : "false") + ",\"writeOperation\":false}");
            return 0;
        }
        catch (Exception ex) { Console.WriteLine("{\"success\":false,\"operation\":\"read_only_vehicle_card_diagnostic\",\"writeOperation\":false,\"result\":\"" + Escape(ex.Message) + "\"}"); return 1; }
        finally { if (card != IntPtr.Zero) SCardDisconnect(card, LeaveCard); if (context != IntPtr.Zero) SCardReleaseContext(context); }
    }
}
