using System;
using System.Linq;
using System.Reflection;

namespace HelpdeskAgent;

public static class ApiDump
{
    public static void Run()
    {
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

        var asm2 = Assembly.Load("SIPSorcery");
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
