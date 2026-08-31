using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public static class UTrustNtag216RfidWrite
{
    private const uint ScopeSystem = 2;
    private const uint ShareShared = 2;
    private const uint ProtocolT0OrT1 = 3;
    private const uint LeaveCard = 0;
    private const int FirstUserPage = 4;

    [StructLayout(LayoutKind.Sequential)]
    private struct IoRequest { public uint Protocol; public uint PciLength; }

    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardEstablishContext(uint scope, IntPtr r1, IntPtr r2, out IntPtr context);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, IntPtr readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, [Out] char[] readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardConnect(IntPtr context, string reader, uint share, uint preferred, out IntPtr card, out uint protocol);
    [DllImport("winscard.dll")] private static extern int SCardTransmit(IntPtr card, ref IoRequest sendPci, byte[] send, int sendLength, IntPtr receivePci, byte[] receive, ref int receiveLength);
    [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, uint disposition);
    [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr context);

    private static string Error(int value) { return string.Format("0x{0:X8}", unchecked((uint)value)); }
    private static string JsonEscape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
    private static void RequireSuccess(byte[] response, int length, string operation)
    {
        if (length < 2 || response[length - 2] != 0x90 || response[length - 1] != 0x00)
        {
            string status = length >= 2 ? string.Format("{0:X2}{1:X2}", response[length - 2], response[length - 1]) : "";
            throw new InvalidOperationException(operation + "_status_" + status);
        }
    }
    private static byte[] Transmit(IntPtr card, ref IoRequest request, byte[] command, string operation)
    {
        byte[] response = new byte[258]; int length = response.Length;
        int rc = SCardTransmit(card, ref request, command, command.Length, IntPtr.Zero, response, ref length);
        if (rc != 0) throw new InvalidOperationException(operation + "_" + Error(rc));
        RequireSuccess(response, length, operation);
        return response.Take(length - 2).ToArray();
    }
    private static byte[] ReadPage(IntPtr card, ref IoRequest request, int page) { return Transmit(card, ref request, new byte[] { 0xFF, 0xB0, 0x00, (byte)page, 0x04 }, "read_page_" + page); }
    private static void WritePage(IntPtr card, ref IoRequest request, int page, byte[] data)
    {
        if (data == null || data.Length != 4) throw new ArgumentException("page_data_must_be_4_bytes");
        Transmit(card, ref request, new byte[] { 0xFF, 0xD6, 0x00, (byte)page, 0x04, data[0], data[1], data[2], data[3] }, "write_page_" + page);
    }
    private static bool IsBlankNdefArea(byte[] data)
    {
        bool allZero = data.All(value => value == 0x00);
        bool emptyNdef = data.Length >= 3 && data[0] == 0x03 && data[1] == 0x00 && data[2] == 0xFE && data.Skip(3).All(value => value == 0x00);
        return allZero || emptyNdef;
    }
    private static byte[] BuildShortRecord(byte header, byte type, byte[] payload)
    {
        if (payload.Length > 255) throw new InvalidOperationException("ndef_short_record_payload_too_large");
        List<byte> record = new List<byte> { header, 0x01, (byte)payload.Length, type };
        record.AddRange(payload);
        return record.ToArray();
    }
    private static byte[] BuildVehicleNdef(string entryUrl, string payloadJson, int ndefCapacityBytes)
    {
        byte[] url = Encoding.UTF8.GetBytes(entryUrl);
        byte[] text = Encoding.UTF8.GetBytes(payloadJson);
        byte[] uriPayload = (new byte[] { 0x00 }).Concat(url).ToArray();
        byte[] textPayload = (new byte[] { 0x02, 0x65, 0x6E }).Concat(text).ToArray();
        List<byte> ndef = new List<byte>();
        ndef.AddRange(BuildShortRecord(0x91, 0x55, uriPayload));
        ndef.AddRange(BuildShortRecord(0x51, 0x54, textPayload));
        List<byte> tlv = new List<byte> { 0x03 };
        if (ndef.Count < 0xFF) tlv.Add((byte)ndef.Count);
        else { tlv.Add(0xFF); tlv.Add((byte)(ndef.Count >> 8)); tlv.Add((byte)(ndef.Count & 0xFF)); }
        tlv.AddRange(ndef); tlv.Add(0xFE);
        while (tlv.Count % 4 != 0) tlv.Add(0x00);
        if (tlv.Count > ndefCapacityBytes) throw new InvalidOperationException("ndef_exceeds_declared_card_capacity");
        return tlv.ToArray();
    }
    private static string Sha256(string value)
    {
        using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
    }
    public static int Main()
    {
        IntPtr context = IntPtr.Zero; IntPtr card = IntPtr.Zero;
        string stage = "prepare";
        try
        {
            string payloadBase64 = Environment.GetEnvironmentVariable("RC_RFID_PAYLOAD_B64");
            string urlBase64 = Environment.GetEnvironmentVariable("RC_RFID_URL_B64");
            bool allowOverwrite = string.Equals(Environment.GetEnvironmentVariable("RC_RFID_ALLOW_OVERWRITE"), "true", StringComparison.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(payloadBase64) || string.IsNullOrWhiteSpace(urlBase64)) throw new InvalidOperationException("bridge_payload_not_supplied");
            string payloadJson = Encoding.UTF8.GetString(Convert.FromBase64String(payloadBase64));
            string entryUrl = Encoding.UTF8.GetString(Convert.FromBase64String(urlBase64));
            if (!payloadJson.StartsWith("{\"t\":\"RC3\"", StringComparison.Ordinal) || !entryUrl.StartsWith("https://yx.maomaoyx.com/mobile/transport?nfc=", StringComparison.Ordinal)) throw new InvalidOperationException("bridge_payload_shape_invalid");
            stage = "reader_connect";
            int rc = SCardEstablishContext(ScopeSystem, IntPtr.Zero, IntPtr.Zero, out context);
            if (rc != 0) throw new InvalidOperationException("establish_context_" + Error(rc));
            uint length = 0; rc = SCardListReaders(context, null, IntPtr.Zero, ref length);
            if (rc != 0) throw new InvalidOperationException("list_readers_" + Error(rc));
            char[] readerChars = new char[length]; rc = SCardListReaders(context, null, readerChars, ref length);
            if (rc != 0) throw new InvalidOperationException("list_readers_" + Error(rc));
            string reader = new string(readerChars).Split('\0').FirstOrDefault(name => name.IndexOf("4701 F CL Reader", StringComparison.OrdinalIgnoreCase) >= 0);
            if (string.IsNullOrWhiteSpace(reader)) throw new InvalidOperationException("utrust_cl_reader_not_found");
            uint protocol; rc = SCardConnect(context, reader, ShareShared, ProtocolT0OrT1, out card, out protocol);
            if (rc != 0) throw new InvalidOperationException("connect_" + Error(rc));
            IoRequest request = new IoRequest { Protocol = protocol, PciLength = (uint)Marshal.SizeOf(typeof(IoRequest)) };
            stage = "capability_container";
            byte[] cc = ReadPage(card, ref request, 3);
            if (cc.Length != 4 || cc[0] != 0xE1 || cc[1] != 0x10 || cc[2] == 0x00) throw new InvalidOperationException("ntag_type2_ndef_cc_not_detected");
            int ndefCapacityBytes = cc[2] * 8;
            int userPageCount = (ndefCapacityBytes + 3) / 4;
            if (FirstUserPage + userPageCount > 0x100) throw new InvalidOperationException("ntag_ndef_user_area_out_of_range");
            byte[] ndef = BuildVehicleNdef(entryUrl, payloadJson, ndefCapacityBytes);
            int pageCount = ndef.Length / 4;
            stage = "read_user_area";
            List<byte> existing = new List<byte>();
            for (int index = 0; index < userPageCount; index++) existing.AddRange(ReadPage(card, ref request, FirstUserPage + index));
            if (!allowOverwrite && !IsBlankNdefArea(existing.ToArray())) { Console.WriteLine("{\"success\":false,\"written\":false,\"verified\":false,\"result\":\"card_user_area_not_blank\"}"); return 4; }
            stage = "clear_user_area";
            if (allowOverwrite) for (int index = 0; index < userPageCount; index++) WritePage(card, ref request, FirstUserPage + index, new byte[] { 0x00, 0x00, 0x00, 0x00 });
            stage = "write_ndef";
            for (int index = 0; index < pageCount; index++) WritePage(card, ref request, FirstUserPage + index, ndef.Skip(index * 4).Take(4).ToArray());
            stage = "verify_ndef";
            List<byte> verified = new List<byte>();
            for (int index = 0; index < pageCount; index++) verified.AddRange(ReadPage(card, ref request, FirstUserPage + index));
            if (!ndef.SequenceEqual(verified.ToArray())) throw new InvalidOperationException("post_write_byte_mismatch");
            Console.WriteLine("{\"success\":true,\"written\":true,\"verified\":true,\"pages\":" + pageCount + ",\"ndefCapacityBytes\":" + ndefCapacityBytes + ",\"payloadFingerprint\":\"" + Sha256(payloadJson) + "\",\"writeProtectionChanged\":false}");
            return 0;
        }
        catch (Exception ex) { Console.WriteLine("{\"success\":false,\"written\":false,\"verified\":false,\"stage\":\"" + JsonEscape(stage) + "\",\"result\":\"" + JsonEscape(ex.Message) + "\"}"); return 1; }
        finally { if (card != IntPtr.Zero) SCardDisconnect(card, LeaveCard); if (context != IntPtr.Zero) SCardReleaseContext(context); }
    }
}
