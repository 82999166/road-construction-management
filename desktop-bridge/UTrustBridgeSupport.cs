using System;
using System.Linq;
using System.Runtime.InteropServices;

public static class UTrustBridgeSupport
{
    private const uint ScopeSystem = 2;
    private const uint ShareShared = 2;
    private const uint ProtocolT0OrT1 = 3;
    private const uint LeaveCard = 0;

    [StructLayout(LayoutKind.Sequential)] private struct IoRequest { public uint Protocol; public uint PciLength; }
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardEstablishContext(uint scope, IntPtr r1, IntPtr r2, out IntPtr context);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, IntPtr readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardListReaders(IntPtr context, string groups, [Out] char[] readers, ref uint length);
    [DllImport("winscard.dll", CharSet = CharSet.Unicode)] private static extern int SCardConnect(IntPtr context, string reader, uint share, uint preferred, out IntPtr card, out uint protocol);
    [DllImport("winscard.dll")] private static extern int SCardTransmit(IntPtr card, ref IoRequest sendPci, byte[] send, int sendLength, IntPtr receivePci, byte[] receive, ref int receiveLength);
    [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, uint disposition);
    [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr context);

    private static string Escape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
    private static string Error(int value) { return string.Format("0x{0:X8}", unchecked((uint)value)); }
    private static string[] GetReaderNames(IntPtr context)
    {
        uint length = 0;
        int rc = SCardListReaders(context, null, IntPtr.Zero, ref length);
        if (rc != 0) throw new InvalidOperationException("list_readers_" + Error(rc));
        if (length == 0) return new string[0];
        char[] chars = new char[length];
        rc = SCardListReaders(context, null, chars, ref length);
        if (rc != 0) throw new InvalidOperationException("list_readers_" + Error(rc));
        return new string(chars).Split('\0').Where(name => !string.IsNullOrWhiteSpace(name)).ToArray();
    }
    private static string GetClReader(IntPtr context)
    {
        string reader = GetReaderNames(context).FirstOrDefault(name => name.IndexOf("4701 F CL Reader", StringComparison.OrdinalIgnoreCase) >= 0);
        if (string.IsNullOrWhiteSpace(reader)) throw new InvalidOperationException("utrust_cl_reader_not_found");
        return reader;
    }

    public static int Probe()
    {
        IntPtr context = IntPtr.Zero;
        try
        {
            int rc = SCardEstablishContext(ScopeSystem, IntPtr.Zero, IntPtr.Zero, out context);
            if (rc != 0) throw new InvalidOperationException("establish_context_" + Error(rc));
            string readers = string.Join(",", GetReaderNames(context).Select(name => "{\"FriendlyName\":\"" + Escape(name) + "\"}").ToArray());
            Console.WriteLine("{\"success\":true,\"SmartCardService\":\"available\",\"Readers\":[" + readers + "]}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"success\":false,\"result\":\"" + Escape(ex.Message) + "\"}");
            return 1;
        }
        finally { if (context != IntPtr.Zero) SCardReleaseContext(context); }
    }

    public static int ReadUid()
    {
        IntPtr context = IntPtr.Zero;
        IntPtr card = IntPtr.Zero;
        try
        {
            int rc = SCardEstablishContext(ScopeSystem, IntPtr.Zero, IntPtr.Zero, out context);
            if (rc != 0) throw new InvalidOperationException("establish_context_" + Error(rc));
            string reader = GetClReader(context);
            uint protocol;
            rc = SCardConnect(context, reader, ShareShared, ProtocolT0OrT1, out card, out protocol);
            if (rc != 0) throw new InvalidOperationException("connect_" + Error(rc));
            IoRequest request = new IoRequest { Protocol = protocol, PciLength = (uint)Marshal.SizeOf(typeof(IoRequest)) };
            byte[] response = new byte[258];
            int responseLength = response.Length;
            rc = SCardTransmit(card, ref request, new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 }, 5, IntPtr.Zero, response, ref responseLength);
            if (rc != 0) throw new InvalidOperationException("read_uid_" + Error(rc));
            if (responseLength < 3 || response[responseLength - 2] != 0x90 || response[responseLength - 1] != 0x00) throw new InvalidOperationException("read_uid_status");
            string uid = BitConverter.ToString(response.Take(responseLength - 2).ToArray()).Replace("-", "");
            if (uid.Length < 8) throw new InvalidOperationException("read_uid_invalid");
            Console.WriteLine("{\"success\":true,\"cardPresent\":true,\"uid\":\"" + uid + "\"}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"success\":false,\"cardPresent\":false,\"result\":\"" + Escape(ex.Message) + "\"}");
            return 1;
        }
        finally
        {
            if (card != IntPtr.Zero) SCardDisconnect(card, LeaveCard);
            if (context != IntPtr.Zero) SCardReleaseContext(context);
        }
    }
}
