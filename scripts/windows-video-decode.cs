// Native Windows Media Foundation diagnostic; no third-party decoder dependency.
// COM method order and GUIDs follow Microsoft's mfobjects.h/mfreadwrite.h/mfapi.h.
using System;
using System.IO;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

public static class WindowsVideoDecode {
    [DllImport("mfplat.dll", ExactSpelling=true)] static extern int MFStartup(int version, int flags);
    [DllImport("mfplat.dll", ExactSpelling=true)] static extern int MFShutdown();
    [DllImport("mfplat.dll", ExactSpelling=true)] static extern int MFCreateAttributes(out IntPtr attributes, int capacity);
    [DllImport("mfplat.dll", ExactSpelling=true)] static extern int MFCreateMediaType(out IntPtr mediaType);
    [DllImport("mfreadwrite.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern int MFCreateSourceReaderFromURL(string url, IntPtr attributes, out IntPtr reader);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetU32(IntPtr p, ref Guid key, uint value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetGuid(IntPtr p, ref Guid key, ref Guid value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetU64(IntPtr p, ref Guid key, out ulong value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SelectStream(IntPtr p, uint stream, int selected);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetType(IntPtr p, uint stream, IntPtr reserved, IntPtr type);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetCurrentType(IntPtr p, uint stream, out IntPtr type);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ReadSample(IntPtr p, uint stream, uint control, out uint actual, out uint flags, out long timestamp, out IntPtr sample);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetBuffer(IntPtr p, out IntPtr buffer);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int LockBuffer(IntPtr p, out IntPtr data, out uint max, out uint length);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int UnlockBuffer(IntPtr p);
    static T Method<T>(IntPtr p,int index) where T:Delegate {
        return Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(p),index*IntPtr.Size));
    }
    static void Check(int result) { Marshal.ThrowExceptionForHR(result); }
    static void Release(ref IntPtr p) { if(p!=IntPtr.Zero) { Marshal.Release(p); p=IntPtr.Zero; } }
    public sealed class Frame {
        public double Seconds {get;set;}
        public string Sha256 {get;set;}
        public string Bitmap {get;set;}
        public bool Nonblank {get;set;}
    }
    public sealed class Result {
        public string Decoder {get;set;} = "Windows Media Foundation RGB32 Source Reader";
        public int Width {get;set;}
        public int Height {get;set;}
        public int DecodedFrames {get;set;}
        public double LastFrameSeconds {get;set;}
        public bool EndOfStream {get;set;}
        public List<Frame> Samples {get;set;} = new List<Frame>();
    }
    static void Bitmap(string path,byte[] pixels,int width,int height) {
        using(var stream=new FileStream(path,FileMode.CreateNew,FileAccess.Write))
        using(var w=new BinaryWriter(stream)) {
            w.Write((ushort)0x4d42); w.Write(54+pixels.Length); w.Write(0); w.Write(54);
            w.Write(40); w.Write(width); w.Write(-height); w.Write((ushort)1); w.Write((ushort)32);
            w.Write(0); w.Write(pixels.Length); w.Write(0); w.Write(0); w.Write(0); w.Write(0);
            w.Write(pixels);
        }
    }
    public static Result Decode(string file,string output) { return Decode(file,output,120,30000,1); }
    public static Result Decode(string file,string output,int maxSeconds,int deadlineMs,int sampleSeconds) {
        if(maxSeconds<1 || maxSeconds>600 || deadlineMs<1000 || deadlineMs>180000 || sampleSeconds<1 || sampleSeconds>2) throw new Exception("invalid_decode_limits");
        const uint video=0xfffffffc, all=0xfffffffe;
        IntPtr attributes=IntPtr.Zero,reader=IntPtr.Zero,type=IntPtr.Zero,current=IntPtr.Zero;
        bool started=false; var result=new Result(); var watch=Stopwatch.StartNew();
        try {
            Check(MFStartup(0x20070,0)); started=true;
            Check(MFCreateAttributes(out attributes,1));
            var processing=new Guid("fb394f3d-ccf1-42ee-bbb3-f9b845d5681d");
            Check(Method<SetU32>(attributes,21)(attributes,ref processing,1));
            Check(MFCreateSourceReaderFromURL(file,attributes,out reader));
            Check(Method<SelectStream>(reader,4)(reader,all,0));
            Check(Method<SelectStream>(reader,4)(reader,video,1));
            Check(MFCreateMediaType(out type));
            var major=new Guid("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
            var videoType=new Guid("73646976-0000-0010-8000-00aa00389b71");
            var subtype=new Guid("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
            var rgb32=new Guid("00000016-0000-0010-8000-00aa00389b71");
            Check(Method<SetGuid>(type,24)(type,ref major,ref videoType));
            Check(Method<SetGuid>(type,24)(type,ref subtype,ref rgb32));
            Check(Method<SetType>(reader,7)(reader,video,IntPtr.Zero,type));
            Check(Method<GetCurrentType>(reader,6)(reader,video,out current));
            var sizeKey=new Guid("1652c33d-d6b2-4012-b834-72030849a37d"); ulong size;
            Check(Method<GetU64>(current,8)(current,ref sizeKey,out size));
            result.Width=(int)(size>>32); result.Height=(int)(size&0xffffffff);
            if(result.Width<1 || result.Height<1 || result.Width>4096 || result.Height>2160) throw new Exception("unsupported_frame_dimensions");
            Directory.CreateDirectory(output); long nextSample=0;
            for(int i=0;i<maxSeconds*120+100;i++) {
                if(watch.ElapsedMilliseconds>deadlineMs) throw new Exception("decode_deadline");
                IntPtr sample=IntPtr.Zero,buffer=IntPtr.Zero; bool locked=false;
                try {
                    uint actual,flags; long time;
                    Check(Method<ReadSample>(reader,9)(reader,video,0,out actual,out flags,out time,out sample));
                    if((flags&1)!=0) throw new Exception("decoder_stream_error");
                    if((flags&2)!=0) { result.EndOfStream=true; break; }
                    if(sample==IntPtr.Zero) continue;
                    if(time<0 || time>maxSeconds*10000000L) throw new Exception("video_duration_limit");
                    result.DecodedFrames++;
                    result.LastFrameSeconds=time/10000000.0;
                    if(time<nextSample) continue;
                    Check(Method<GetBuffer>(sample,41)(sample,out buffer));
                    IntPtr data; uint max,length;
                    Check(Method<LockBuffer>(buffer,3)(buffer,out data,out max,out length)); locked=true;
                    int required=checked(result.Width*result.Height*4);
                    if(length!=required) throw new Exception("unexpected_rgb32_stride_or_length");
                    var pixels=new byte[required]; Marshal.Copy(data,pixels,0,required);
                    var colors=new HashSet<int>(); int lit=0;
                    for(int j=0;j<pixels.Length;j+=64) {
                        int b=pixels[j],g=pixels[j+1],r=pixels[j+2];
                        colors.Add((r<<16)|(g<<8)|b); if(r+g+b>48) lit++;
                    }
                    string bitmap=Path.Combine(output,"frame-"+result.Samples.Count.ToString("D2")+".bmp");
                    // Keep hashes throughout the clip; bounded image exports avoid gigabytes of BMPs.
                    if(result.Samples.Count<24) Bitmap(bitmap,pixels,result.Width,result.Height);
                    else bitmap=null;
                    result.Samples.Add(new Frame { Seconds=time/10000000.0, Bitmap=bitmap,
                        Sha256=Convert.ToHexString(SHA256.HashData(pixels)).ToLowerInvariant(),
                        Nonblank=colors.Count>=8 && lit>pixels.Length/64/100 });
                    nextSample=time+sampleSeconds*10000000L;
                } finally {
                    try { if(locked) Check(Method<UnlockBuffer>(buffer,4)(buffer)); }
                    finally { Release(ref buffer); Release(ref sample); }
                }
            }
            if(!result.EndOfStream || result.DecodedFrames==0) throw new Exception("incomplete_decode");
            return result;
        } finally {
            Release(ref current); Release(ref type); Release(ref reader); Release(ref attributes);
            if(started) MFShutdown();
        }
    }
}
