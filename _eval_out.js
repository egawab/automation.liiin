(function(){
var posts=[],seen={},debugLog=[];
function norm(s){return String(s||"").replace(/[\u0660-\u0669]/g,function(c){return c.charCodeAt(0)-0x660;}).replace(/[\u06F0-\u06F9]/g,function(c){return c.charCodeAt(0)-0x6F0;});}
function pe(s){if(!s)return 0;var x=norm(s).toUpperCase().replace(/,/g,"").replace(/\./g,".");var n=parseFloat((x.match(/[0-9]+\.?[0-9]*/)||[])[0]);if(isNaN(n))return 0;if(x.indexOf("K")>-1)n*=1000;if(x.indexOf("M")>-1)n*=1000000;return Math.floor(n);}
function xUrn(s){if(!s)return "";var m=String(s).match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);if(m)return "urn:li:"+m[1]+":"+m[2];var p=String(s).match(/activity-([0-9]{10,25})/i);if(p)return "urn:li:activity:"+p[1];return "";}
function getHash(txt,auth,mediaStr){
  var na=auth.split("\n")[0].replace(/^[Vv]iew\s+(?:company:\s*)?/i,"").replace(/[\u2019\u0027]s\s.*$/i,"").replace(/\s*[\u2022\u00B7].*$/,"").trim();
  var str = na + "|" + txt.length + "|" + txt.substring(0,300) + "|" + txt.substring(txt.length-300) + "|" + mediaStr;
  var h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for(var i=0; i<str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return { urn: "urn:li:hash:" + (h2>>>0).toString(16).padStart(8, "0") + (h1>>>0).toString(16).padStart(8, "0"), input: str };
}
function getEng(el){
  var lk=0,cm=0;
  try{var sdc=el.querySelector(".social-details-social-counts,.update-components-social-counts");
    if(sdc){var nums=[];Array.from(sdc.querySelectorAll("span,button,li")).forEach(function(x){
      var t=norm((x.innerText||"").trim());if(/^[0-9]+$/.test(t)&&t.length<9){var n=parseInt(t,10);if(n>0&&nums.indexOf(n)<0)nums.push(n);}
    });if(nums[0])lk=nums[0];if(nums[1])cm=nums[1];}}catch(e){}
  if(!lk&&!cm)try{Array.from(el.querySelectorAll("[aria-label]")).forEach(function(x){
    var raw=x.getAttribute("aria-label")||"";var a=norm(raw);
    if(/[0-9]/.test(a)&&/(reaction|like|reacted|تفاعل|إعجاب|\u0631\u062F\u0648\u062F)/i.test(raw))lk=Math.max(lk,pe(a));
    if(/[0-9]/.test(a)&&/(comment|تعليق)/i.test(raw))cm=Math.max(cm,pe(a));
  });}catch(e){}
  if(!lk&&!cm)try{Array.from(el.querySelectorAll("button")).forEach(function(b){
    var raw=(b.innerText||"").trim();var t=norm(raw);
    if(/[0-9]/.test(t)&&/(like|reaction|تفاعل|إعجاب)/i.test(raw))lk=Math.max(lk,pe(t));
    if(/[0-9]/.test(t)&&/(comment|تعليق)/i.test(raw))cm=Math.max(cm,pe(t));
  });}catch(e){}
  if(!lk&&!cm)try{var nums2=[];Array.from(el.querySelectorAll("span")).forEach(function(x){
    var t=norm((x.innerText||"").trim());if(/^[0-9]{1,8}$/.test(t)){var n=parseInt(t,10);if(n>0&&nums2.indexOf(n)<0)nums2.push(n);}
  });if(nums2.length>=2){lk=nums2[0];cm=nums2[1];}else if(nums2.length===1)lk=nums2[0];}catch(e){}
  return {likes:lk,comments:cm};}
function getText(el){
  var txt="",skipRx=/^(Pause|Skip Forward|Skip Backward|Unmute|Current Time|Duration|Loaded:|Stream Type|Seek to live|Remaining Time|Playback Rate|Chapters|Captions|Audio Track|Picture-in-Picture|Fullscreen|Volume)/i;
  var ss=[".update-components-text",".feed-shared-update-v2__description",".attributed-text-segment-list__content",".break-words",".feed-shared-text",".feed-shared-inline-show-more-text","[dir=\"ltr\"]","[dir=\"rtl\"]"];
  ss.forEach(function(s){try{Array.from(el.querySelectorAll(s)).forEach(function(d){
    if(d.closest('[aria-label="Video Player"]'))return;
    var t=(d.innerText||"").trim();if(t.length>txt.length&&!skipRx.test(t))txt=t;
  });}catch(e){}});
  if(txt.length<20){var raw=(el.innerText||"").replace(/\s+/g," ").trim();if(!skipRx.test(raw))txt=raw.substring(0,3000);}
  return txt;}
function getAuthor(el){
  var a=el.querySelector("a[href*=\"/in/\"],a[href*=\"/company/\"]");if(!a)return "Unknown";
  var aria=a.getAttribute("aria-label")||"";
  if(aria){
    var cl=aria.replace(/^[Vv]iew\s+(?:company:\s*)?/i,"").replace(/(?:[\'’‘´`]s\s.*|\s+Verified.*|\s+Top\s+Voice.*|\s+Profile.*|\s+\d.*)$/i,"");
    if(cl)return cl.trim().substring(0,100);
  }
  var name=(a.innerText||"").trim().replace(/^[Vv]iew\s+(?:company:\s*)?/i,"").split("\n")[0].trim().substring(0,100);
  if(name.length>1)return name;
  var img=a.querySelector("img[alt]");if(img)return (img.getAttribute("alt")||"").trim().substring(0,100);
  return "Unknown";}
function xPost(urn,el,href,hashInput){
  var eng=getEng(el);var txt=getText(el);var auth=getAuthor(el);
  var isDup=seen[urn]?true:false;
  console.log("POST DEBUG:\n- rawTextLength: "+(el.innerText||"").length+"\n- normalizedTextLength: "+txt.length+"\n- author: "+auth+"\n- extractedURN: "+(hashInput?"(none)":urn)+"\n- generatedHashInput: "+(hashInput?hashInput:"(none)")+"\n- generatedHash: "+(hashInput?urn:"(none)")+"\n- dedupeDecision: "+(isDup?"DUPLICATE":"NEW")+"\n- dedupeReason: "+(isDup?"Already seen in this cycle":"First time seen"));
  if(isDup)return;seen[urn]=1;
  if(debugLog.length<3)debugLog.push({urn:urn.slice(-12),textLen:txt.length,author:auth.substring(0,20),likes:eng.likes,comments:eng.comments,cls:(el.className||"").substring(0,40),ariaLabels:Array.from(el.querySelectorAll("[aria-label]")).map(function(x){return x.getAttribute("aria-label");}).filter(Boolean).slice(0,6)});
  posts.push({urn:urn,url:href||(urn.indexOf("urn:li:hash:")<0?"https://www.linkedin.com/feed/update/"+urn:""),text:txt.substring(0,3000),author:auth,likes:eng.likes,comments:eng.comments});}
function card(el,urn){var c=el,firstHit=null;for(var i=0;i<30;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||"").trim().length;if(l>40&&l<15000){if(!firstHit)firstHit=c;if(c.querySelectorAll("[aria-label]").length>0){xPost(urn,c,"");return;}}if(l>=15000)break;}if(firstHit)xPost(urn,firstHit,"");}
try{Array.from(document.querySelectorAll("a[href]")).filter(function(a){return a.href&&(a.href.indexOf("feed/update/urn:li:")>-1||a.href.indexOf("/posts/")>-1);}).forEach(function(lnk){var urn=xUrn(lnk.href);if(!urn||seen[urn])return;var c=lnk,fh=null;for(var i=0;i<30;i++){c=c.parentElement;if(!c||c===document.body)break;var l=(c.innerText||"").trim().length;if(l>40&&l<15000){if(!fh)fh=c;if(c.querySelectorAll("[aria-label]").length>0){xPost(urn,c,lnk.href);fh=null;break;}}if(l>=15000)break;}if(fh)xPost(urn,fh,lnk.href);});}catch(e){}
try{["data-urn","data-activity-urn","data-chameleon-result-urn","data-entity-urn","data-id"].forEach(function(attr){Array.from(document.querySelectorAll("["+attr+"]")).forEach(function(el){var urn=xUrn(el.getAttribute(attr)||"");if(!urn||seen[urn])return;card(el,urn);});});}catch(e){}
try{Array.from(document.querySelectorAll("a[href*=activity-]")).forEach(function(a){var urn=xUrn(a.href);if(!urn||seen[urn])return;card(a,urn);});}catch(e){}
try{var seenCards=[];Array.from(document.querySelectorAll("a[href*=\"/in/\"],a[href*=\"/company/\"]")).forEach(function(a){
  var c=a,fh=null,firstHit=null;for(var i=0;i<30;i++){c=c.parentElement;if(!c||c===document.body)break;
    var l=(c.innerText||"").trim().length;
    if(l>150&&l<15000){
      if(!firstHit)firstHit=c;
      if(c.querySelectorAll("[aria-label]").length>0){fh=c;break;}
    }if(l>=15000)break;
  }
  var fc=fh||firstHit;
  if(fc&&seenCards.indexOf(fc)<0){
    seenCards.push(fc);
    var h=fc.innerHTML||"";
    var m=h.match(/urn:li:(activity|ugcPost|share):([0-9]{10,25})/);
    var urn="", hashIn="";
    if(m)urn="urn:li:"+m[1]+":"+m[2];
    if(!urn){var p=h.match(/activity-([0-9]{10,25})/i);if(p)urn="urn:li:activity:"+p[1];}
    if(!urn){
      var txt=getText(fc);var auth=getAuthor(fc);
      var mediaStr=Array.from(fc.querySelectorAll("img[src],video")).map(function(n){return n.src||n.poster||"";}).filter(function(s){return s&&s.indexOf("profile")<0;}).join(",");
      var hashObj=getHash(txt,auth,mediaStr); urn=hashObj.urn; hashIn=hashObj.input;
    }
    if(urn)xPost(urn,fc,"",hashIn);
  }
});}catch(e){}
return JSON.stringify({posts:posts,count:posts.length,strategy:"FEED_CLASSIC",debug:debugLog});
})()