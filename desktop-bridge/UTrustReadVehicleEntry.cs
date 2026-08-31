using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

public static class UTrustReadVehicleEntry
{
    private const uint ScopeSystem = 2;
    private const uint ShareShared = 2;
    private const uint ProtocolT0OrT1 = 3;
    private const uint LeaveCard = 0;
    private const int FirstUserPage = 4;

    [StructLayout(LayoutKind.Sequential)] private struct IoRequest { public uint Protocol; public uint PciLength; }
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardEstablishContext(uint scope, IntPtr a, IntPtr b, out IntPtr context);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, IntPtr readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, [Out] char[] readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardConnect(IntPtr context, string reader, uint share, uint protocol, out IntPtr card, out uint activeProtocol);
    [DllImport("winscard.dll")] private static extern int SCardTransmit(IntPtr card, ref IoRequest request, byte[] send, int sendLength, IntPtr recvRequest, byte[] recv, ref int recvLength);
    [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, uint disposition);
    [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr context);

    private static string Error(int value) { return string.Format("0x{0:X8}", unchecked((uint)value)); }
    private static string JsonEscape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
    private static byte[] ReadPage(IntPtr card, ref IoRequest request, int page)
    {
        byte[] response = new byte[16]; int length = response.Length;
        int rc = SCardTransmit(card, ref request, new byte[] { 0xFF, 0xB0, 0x00, (byte)page, 0x04 }, 5, IntPtr.Zero, response, ref length);
        if (rc != 0) throw new InvalidOperationException("read_page_" + page + "_" + Error(rc));
        if (length != 6 || response[4] != 0x90 || response[5] != 0x00) throw new InvalidOperationException("read_page_" + page + "_status");
        return response.Take(4).ToArray();
    }
    private static int ReadBigEndian(byte[] bytes, ref int position, int count, int limit)
    {
        if (position + count > limit) throw new InvalidOperationException("vehicle_ndef_length_out_of_range");
        int result = 0;
        for (int index = 0; index < count; index++) result = (result << 8) | bytes[position++];
        return result;
    }
    private static string ParseVehicleEntryUrl(byte[] userData)
    {
        int position = 0;
        while (position < userData.Length && userData[position] == 0x00) position++;
        if (position >= userData.Length || userData[position++] != 0x03) throw new InvalidOperationException("vehicle_ndef_tlv_not_found");
        int ndefLength = ReadBigEndian(userData, ref position, 1, userData.Length);
        if (ndefLength == 0xFF) ndefLength = ReadBigEndian(userData, ref position, 2, userData.Length);
        int end = position + ndefLength;
        if (ndefLength <= 0 || end > userData.Length) throw new InvalidOperationException("vehicle_ndef_tlv_length_invalid");
        if (position >= end) throw new InvalidOperationException("vehicle_ndef_record_not_found");
        byte header = userData[position++];
        bool messageBegin = (header & 0x80) != 0;
        bool shortRecord = (header & 0x10) != 0;
        bool idLengthPresent = (header & 0x08) != 0;
        int tnf = header & 0x07;
        if (!messageBegin || !shortRecord || idLengthPresent || tnf != 0x01) throw new InvalidOperationException("vehicle_ndef_uri_record_invalid");
        int typeLength = ReadBigEndian(userData, ref position, 1, end);
        int payloadLength = ReadBigEndian(userData, ref position, 1, end);
        if (typeLength != 1 || position + typeLength + payloadLength > end || userData[position] != 0x55) throw new InvalidOperationException("vehicle_ndef_uri_record_invalid");
        position += typeLength;
        if (payloadLength < 2 || userData[position] != 0x00) throw new InvalidOperationException("vehicle_ndef_uri_prefix_invalid");
        string entryUrl = Encoding.UTF8.GetString(userData, position + 1, payloadLength - 1);
        Uri uri;
        if (!Uri.TryCreate(entryUrl, UriKind.Absolute, out uri) || !string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase) || !string.Equals(uri.Host, "yx.maomaoyx.com", StringComparison.OrdinalIgnoreCase) || uri.Port != 443 || !string.Equals(uri.AbsolutePath, "/mobile/transport", StringComparison.Ordinal) || !string.IsNullOrEmpty(uri.Fragment) || !string.IsNullOrEmpty(uri.UserInfo)) throw new InvalidOperationException("vehicle_ndef_entry_url_not_allowed");
        string query = uri.Query.TrimStart('?');
        string[] parts = query.Split('&');
        if (parts.Length != 1 || !parts[0].StartsWith("nfc=", StringComparison.Ordinal)) throw new InvalidOperationException("vehicle_ndef_entry_parameter_invalid");
        string token = parts[0].Substring(4);
        if (token.Length < 16 || token.Length > 2048 || token.Any(character => !(char.IsLetterOrDigit(character) || character == '-' || character == '_'))) throw new InvalidOperationException("vehicle_ndef_entry_parameter_invalid");
        return entryUrl;
    }
    public static int Main()
    {
        IntPtr context = IntPtr.Zero; IntPtr card = IntPtr.Zero;
        try
        {
            int rc = SCardEstablishContext(ScopeSystem, IntPtr.Zero, IntPtr.Zero, out context);
            if (rc != 0) throw new InvalidOperationException("context_" + Error(rc));
            uint count = 0; rc = SCardListReaders(context, null, IntPtr.Zero, ref count);
            if (rc != 0) throw new InvalidOperationException("readers_" + Error(rc));
            char[] names = new char[count]; rc = SCardListReaders(context, null, names, ref count);
            if (rc != 0) throw new InvalidOperationException("readers_" + Error(rc));
            string reader = new string(names).Split('\0').FirstOrDefault(name => name.IndexOf("4701 F CL Reader", StringComparison.OrdinalIgnoreCase) >= 0);
            if (string.IsNullOrWhiteSpace(reader)) throw new InvalidOperationException("utrust_cl_reader_not_found");
            uint protocol; rc = SCardConnect(context, reader, ShareShared, ProtocolT0OrT1, out card, out protocol);
            if (rc != 0) throw new InvalidOperationException("connect_" + Error(rc));
            IoRequest request = new IoRequest { Protocol = protocol, PciLength = (uint)Marshal.SizeOf(typeof(IoRequest)) };
            byte[] cc = ReadPage(card, ref request, 3);
            if (cc.Length != 4 || cc[0] != 0xE1 || cc[1] != 0x10 || cc[2] == 0x00) throw new InvalidOperationException("ntag_type2_ndef_cc_not_detected");
            int capacity = cc[2] * 8;
            int pageCount = (capacity + 3) / 4;
            if (FirstUserPage + pageCount > 0x100) throw new InvalidOperationException("ntag_ndef_user_area_out_of_range");
            List<byte> userData = new List<byte>();
            for (int index = 0; index < pageCount; index++) userData.AddRange(ReadPage(card, ref request, FirstUserPage + index));
            string entryUrl = ParseVehicleEntryUrl(userData.ToArray());
            Console.WriteLine("{\"success\":true,\"nfcEntryUrl\":\"" + JsonEscape(entryUrl) + "\",\"reader\":\"" + JsonEscape(reader) + "\"}");
            return 0;
        }
        catch (Exception ex) { Console.WriteLine("{\"success\":false,\"result\":\"" + JsonEscape(ex.Message) + "\"}"); return 1; }
        finally { if (card != IntPtr.Zero) SCardDisconnect(card, LeaveCard); if (context != IntPtr.Zero) SCardReleaseContext(context); }
    }
}
