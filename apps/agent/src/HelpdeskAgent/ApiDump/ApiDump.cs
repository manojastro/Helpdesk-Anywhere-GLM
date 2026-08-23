using System;
using System.Linq;
using System.Reflection;

namespace HelpdeskAgent;

public static class ApiDump
{
    public static void Run()
    {
        try
        {
            try
            {
                var vpx = new SIPSorceryMedia.Encoders.VpxVideoEncoder();
                Console.WriteLine("VPX-ENCODER-OK formats=" + vpx.SupportedFormats.Count);
                foreach (var f in vpx.SupportedFormats)
                    Console.WriteLine("  VFMT " + f.Codec);
            }
            catch (Exception ex)
            {
                Console.WriteLine("VPX-ENCODER-FAIL " + ex.Message + " INNER=" + (ex.InnerException?.Message ?? "-"));
            }
        }
        catch { }
        try
        {
            var vep = new SIPSorceryMedia.Encoders.VideoEncoderEndPoint();
            var fmts = vep.GetVideoSourceFormats();
            Console.WriteLine("VEP-FORMATS count=" + fmts.Count);
            foreach (var f in fmts)
                Console.WriteLine("  FMT " + f.Codec + " " + f.FormatName);
            vep.ExternalVideoSourceRawSample(100, 2, 2, new byte[16], SIPSorceryMedia.Abstractions.VideoPixelFormatsEnum.Bgra);
            Console.WriteLine("VEP-FEED-OK");
        }
        catch (Exception ex)
        {
            Console.WriteLine("VEP-ERROR " + ex);
        }

        var common = Assembly.Load("SocketIOClient.Common");
        var asm = Assembly.Load("SocketIOClient");
        foreach (var t in asm.GetExportedTypes().Concat(common.GetExportedTypes()).Where(t => t.Name == "SocketIOOptions" || t.Name == "SocketIO" || t.Name.Contains("Transport") || t.Name.Contains("Response")))
        {
            Console.WriteLine("TYPE " + t.FullName);
            foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                Console.WriteLine("  PROP " + p.PropertyType.Name + " " + p.Name);
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => m.Name.StartsWith("Emit") || m.Name.StartsWith("On") || m.Name.StartsWith("Connect")))
                Console.WriteLine("  METHOD " + m);
        }

        foreach (var name in new[] { "SIPSorcery.VP8", "SIPSorceryMedia.Encoders", "SIPSorceryMedia.Abstractions" })
        {
            try
            {
                var a = Assembly.Load(name);
                Console.WriteLine("ASM " + name);
                foreach (var t in a.GetExportedTypes().Where(t => t.Name.Contains("Encoder") || t.Name.Contains("VP8") || t.Name.Contains("Track") || t.Name.Contains("VideoTestPattern")))
                {
                    Console.WriteLine("TYPE " + t.FullName);
                    foreach (var c in t.GetConstructors())
                        Console.WriteLine("  CTOR " + c);
                    foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => !m.Name.StartsWith("get_") && !m.Name.StartsWith("set_")))
                        Console.WriteLine("  METHOD " + m);
                    foreach (var ev in t.GetEvents(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                        Console.WriteLine("  EVENT " + ev.Name + " : " + ev.EventHandlerType.Name);
                }
            }
            catch (Exception ex) { Console.WriteLine("ERR " + name + ": " + ex.Message); }
        }
        var asm2 = Assembly.Load("SIPSorcery");
        var pcT = asm2.GetType("SIPSorcery.Net.RTCPeerConnection");
        foreach (var m in pcT!.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => m.Name.Contains("Video") || m.Name.Contains("Send") || m.Name.Contains("addTrack") || m.Name.Contains("FormatsNegotiated")))
            Console.WriteLine("PCX " + m);
        foreach (var ev in pcT.GetEvents(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(ev => ev.Name.Contains("Video") || ev.Name.Contains("Negotiat")))
            Console.WriteLine("PCEV " + ev.Name + " : " + ev.EventHandlerType.Name);
        var encT = asm2.GetType("SIPSorcery.Net.MediaStreamTrack");
        foreach (var m in encT!.GetMethods(BindingFlags.Public | BindingFlags.Instance).Where(m => m.Name.Contains("Encoded") || m.Name.Contains("Sample")))
            Console.WriteLine("MSTX " + m);
        var absA = Assembly.Load("SIPSorceryMedia.Abstractions");
        foreach (var t3 in absA.GetExportedTypes().Where(t3 => t3.Name.Contains("Delegate") || t3.Name == "EncodedSampleDelegate"))
        {
            Console.WriteLine("DELEG2 " + t3.FullName);
            if (t3.GetMethod("Invoke") is not null)
                foreach (var p in t3.GetMethod("Invoke")!.GetParameters())
                    Console.WriteLine("  P " + p.ParameterType.Name + " " + p.Name);
        }
        var mst = asm2.GetType("SIPSorcery.Net.MediaStreamTrack");
        if (mst is not null)
        {
            Console.WriteLine("TYPE " + mst.FullName);
            foreach (var c in mst.GetConstructors())
                Console.WriteLine("  CTOR " + c);
            foreach (var m in mst.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => !m.Name.StartsWith("get_") && !m.Name.StartsWith("set_")))
                Console.WriteLine("  METHOD " + m);
        }
        var del = asm2.GetType("SIPSorcery.Net.OnDataChannelMessageDelegate");
        if (del is not null)
        {
            Console.WriteLine("DELEGATE " + del.FullName);
            foreach (var p in del.GetMethod("Invoke")!.GetParameters())
                Console.WriteLine("  PARAM " + p.ParameterType.Name + " " + p.Name);
        }
        foreach (var t2 in asm2.GetExportedTypes().Where(t => t.Name.Contains("DataChannelPayload")))
            Console.WriteLine("ENUM " + t2.FullName + " : " + string.Join(",", Enum.GetNames(t2)));

        var dc = asm2.GetType("SIPSorcery.Net.RTCDataChannel")!;
        Console.WriteLine("TYPE " + dc.FullName);
        foreach (var f in dc.GetFields(BindingFlags.Public | BindingFlags.Instance))
            Console.WriteLine("  FIELD " + f.FieldType.Name + " " + f.Name);
        foreach (var m in dc.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => m.Name.ToLower().Contains("send")))
            Console.WriteLine("  METHOD " + m);
        var pc = asm2.GetType("SIPSorcery.Net.RTCPeerConnection")!;
        foreach (var f in pc.GetFields(BindingFlags.Public | BindingFlags.Instance).Where(f => f.Name.StartsWith("on")))
            Console.WriteLine("  PC-FIELD " + f.FieldType.Name + " " + f.Name);
        foreach (var m in pc.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => m.Name.Contains("Ice") || m.Name.Contains("Description") || m.Name.Contains("Answer") || m.Name.Contains("Close")))
            Console.WriteLine("  PC-METHOD " + m);
    }
}
