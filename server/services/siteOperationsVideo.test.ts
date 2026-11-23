import { describe, expect, it, vi } from "vitest";
vi.mock("../db",()=>({getDb:vi.fn()}));
vi.mock("../_core/context",()=>({createContext:vi.fn(async()=>({user:null}))}));
vi.mock("../storage",()=>({storagePut:vi.fn(),storageGetSignedUrl:vi.fn()}));
import { decodeSiteVideo, isPrivateSiteVideoKey, siteVideoRange, registerSiteOperationsVideo } from "./siteOperationsVideo";
import { isLargeTrpcBodyRequest } from "../_core/httpSecurity";
import { registerStorageProxy } from "../_core/storageProxy";
import { siteVideoSchema, SITE_VIDEO_MAX_BYTES } from "../../shared/siteOperations";
function mp4(){const b=Buffer.alloc(32);b.writeUInt32BE(24,0);b.write("ftyp",4);b.write("isom",8);return b;}
const video=(url:string)=>({id:"v",name:"录像",pointLabel:"点位",kind:"recorded",url,recordedAt:null,enabled:true,sortOrder:0,default:true});
describe("siteOperations controlled video",()=>{
 it("MP4 magic+brand accepted，改MIME或伪装HTML拒绝",()=>{expect(decodeSiteVideo(mp4().toString("base64"),"video/mp4")).toEqual(mp4());expect(()=>decodeSiteVideo(mp4().toString("base64"),"video/webm")).toThrow();expect(()=>decodeSiteVideo(Buffer.from("<html>not video</html>").toString("base64"),"video/mp4")).toThrow();});
 it("WebM要求EBML与webm doc type",()=>{const b=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from("\0webm\0paddingpadding")]);expect(decodeSiteVideo(b.toString("base64"),"video/webm")).toEqual(b);expect(()=>decodeSiteVideo(b.toString("base64"),"video/mp4")).toThrow();});
 it("规范base64和16MB上限",()=>{expect(()=>decodeSiteVideo("AAAA\n","video/mp4")).toThrow();expect(()=>decodeSiteVideo(Buffer.alloc(SITE_VIDEO_MAX_BYTES+1).toString("base64"),"video/mp4")).toThrow();expect(()=>decodeSiteVideo("", "video/mp4")).toThrow();});
 it.each(["http://cdn.domain.com/a.mp4","https://localhost/a.mp4","https://127.0.0.1/a.mp4","https://10.0.0.1/a.mp4","https://[::1]/a.mp4","https://user:pass@cdn.domain.com/a.mp4","https://evil.internal/a.mp4","https://127.0.0.1.nip.io/a.mp4","rtsp://camera.local/a","https://2130706433/a.mp4"])("unsafe URL拒绝%s",url=>expect(siteVideoSchema.safeParse(video(url)).success).toBe(false));
 it("公开https域名可提交但服务端还需DNS验证",()=>expect(siteVideoSchema.safeParse(video("https://cdn.domain.com/a.mp4")).success).toBe(true));
 it("只给uploadVideo精确名称大请求能力",()=>{expect(isLargeTrpcBodyRequest({path:"/siteOperations.uploadVideo"} as any)).toBe(true);for(const p of ["/siteOperations.saveConfiguration","/siteOperations.uploadVideo.other","/siteOperations.dashboard"])expect(isLargeTrpcBodyRequest({path:p} as any)).toBe(false);});
 it.each(["site-operations-private/2/v.enc","x/../site-operations-private/2/v.enc","site-operations-private\\2\\v.enc","%73ite-operations-private%2f2%2fv.enc","x/site-operations-private/2/v.enc"])("generic proxy拒绝私有key及别名%s",async key=>{expect(isPrivateSiteVideoKey(key)).toBe(true);let handler:any;registerStorageProxy({get:(_:any,h:any)=>{handler=h;}} as any);const res:any={statusCode:200,status(n:number){this.statusCode=n;return this;},set(){return this;},send:vi.fn()};await handler({params:{key:key.split("/")}},res);expect(res.statusCode).toBe(403);});
 it("授权公开样片不被namespace规则拒绝",()=>{expect(isPrivateSiteVideoKey("excavator-sample_f339c2da.mp4")).toBe(false);});
 it("Range首段/尾段/边界正确，不支持多个Range或越界",()=>{expect(siteVideoRange("bytes=0-9",20)).toEqual({start:0,end:9});expect(siteVideoRange("bytes=10-",20)).toEqual({start:10,end:19});expect(siteVideoRange("bytes=-5",20)).toEqual({start:15,end:19});expect(siteVideoRange(undefined,20)).toBeNull();for(const h of ["bytes=20-","bytes=5-2","bytes=0-1,4-5","bytes=-0"])expect(()=>siteVideoRange(h,20)).toThrow();});
 it("受控video媒体端点匿名即拒绝，不读取附件",async()=>{let h:any;registerSiteOperationsVideo({get:(_:any,f:any)=>{h=f;}} as any);const res:any={statusCode:200,status(n:number){this.statusCode=n;return this;},set(){return this;},send:vi.fn()};await h({params:{projectId:"2",reference:"3"},headers:{}},res);expect(res.statusCode).toBe(403);});
});
