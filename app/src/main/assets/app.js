const $=id=>document.getElementById(id);
const load=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(16).slice(2);
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

let apiKey=localStorage.getItem("ds_key")||"";
let model=localStorage.getItem("ds_model")||"deepseek-chat";
let books=load("books",[]);
let currentBook=null;
let currentChapter=0;
let writing=false;
let totalTokens=0;
let bookPhase="idle"; // idle|consulting|outline|writing

// === Toast ===
function toast(msg,dur){
  dur=dur||2000;var old=document.querySelector(".toast");if(old)old.remove();
  var t=document.createElement("div");t.className="toast";t.textContent=msg;
  document.body.appendChild(t);requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{t.classList.remove("show");setTimeout(()=>t.remove(),300)},dur);
}

// === Navigation ===
function showBookshelf(){$("bookshelfPage").classList.remove("hidden");$("writePage").classList.add("hidden");renderBookshelf();}
function showWritePage(book){currentBook=book;currentChapter=book.chapters?book.chapters.length-1:0;$("bookshelfPage").classList.add("hidden");$("writePage").classList.remove("hidden");$("bookTitle").textContent=book.name;renderChapter();}
function showSettings(){$("bookshelfPage").classList.add("hidden");$("settingsPage").classList.remove("hidden");if(apiKey)$("cfgApiKey").value=apiKey;}
function hideSettings(){$("settingsPage").classList.add("hidden");$("bookshelfPage").classList.remove("hidden");}

// === Bookshelf ===
function renderBookshelf(){
  var grid=$("bookGrid");
  if(!books.length){grid.innerHTML='<div class="book-empty">还没有作品<br><br>点击 + 开始创作第一部小说</div>';return;}
  grid.innerHTML=books.map(function(b,i){
    var words=b.chapters?b.chapters.reduce(function(s,c){return s+(c.content?c.content.length:0)},0):0;
    return '<div class="book-card" onclick="openBook('+i+')"><div class="book-name">'+esc(b.name)+'</div><div class="book-meta">'+(b.chapters?b.chapters.length:0)+' 章 · '+words+' 字</div><div class="book-genre">'+esc(b.genre||"未分类")+'</div></div>';
  }).join("");
}

function createBook(){
  if(!apiKey){toast("⚠ 请先在设置中配置密钥");showSettings();return;}
  showOverlay("创建新书","书名：","text","输入书名...",function(name){
    if(!name.trim())return;
    showOverlay("选择风格","风格：","select","玄幻 科幻 悬疑 言情 都市 历史 武侠 奇幻",function(genre){
      var book={id:uid(),name:name.trim(),genre:genre,chapters:[],characters:[],worldbuilding:"",outline:"",createdAt:Date.now()};
      books.push(book);save("books",books);
      toast("✅ 已创建");showWritePage(book);
      startConsultation(book);
    });
  });
}

function openBook(i){
  var book=books[i];
  showWritePage(book);
  // 如果还没有大纲，进入讨论阶段
  if(!book.outline||book.outline===""){
    bookPhase="consulting";
    updateChips();
    startConsultation(book);
  }else{
    bookPhase="writing";
  }
}

function startConsultation(book){
  bookPhase="consulting";
  updateChips();
  var prompt="用户想写一部"+(book.genre||"")+"小说，书名叫《"+book.name+"》。\n\n请你先和用户讨论以下内容，不要直接生成大纲：\n1. 主角设定：名字、年龄、性格、背景、能力\n2. 核心冲突：主角面临的主要矛盾\n3. 世界观：故事发生在什么样的世界\n4. 基调：轻松/严肃/热血/阴暗\n5. 想要的结局走向\n\n用轻松聊天的语气，分点提问，一次不要问太多，先从主角和核心冲突开始。\n\n等用户确认所有设定后，再说：'设定已确认，我来生成大纲'，然后调用 generateOutline。";
  writing=true;showTyping();
  callAI(prompt).then(function(resp){
    hideTyping();writing=false;
    if(resp){addMsgToArea("ai",resp);}
  });
}

function showBookMenu(){
  if(!currentBook)return;
  var overlay=document.createElement("div");overlay.className="overlay";
  overlay.innerHTML='<div class="overlay-box"><p>'+esc(currentBook.name)+'</p><div class="overlay-actions"><button onclick="exportBook()">📤 导出</button><button class="danger" onclick="deleteBook()">🗑 删除</button><button onclick="this.closest(\'.overlay\').remove()">取消</button></div></div>';
  document.body.appendChild(overlay);
}

function deleteBook(){
  books=books.filter(function(b){return b.id!==currentBook.id});
  save("books",books);currentBook=null;
  document.querySelector(".overlay")?.remove();
  showBookshelf();toast("✅ 已删除");
}

function exportBook(){
  if(!currentBook||!currentBook.chapters.length){toast("⚠ 还没有内容");return;}
  var text=currentBook.name+"\n\n";
  currentBook.chapters.forEach(function(c,i){text+="第"+(i+1)+"章 "+(c.title||"")+"\n\n"+c.content+"\n\n";});
  var blob=new Blob([text],{type:"text/plain"});
  var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=currentBook.name+".txt";a.click();
  document.querySelector(".overlay")?.remove();toast("✅ 已导出");
}

// === Chapter rendering ===
function renderChapter(){
  var area=$("chapterContent");
  if(!currentBook||!currentBook.chapters||!currentBook.chapters.length){
    if(bookPhase==="consulting"){
      area.innerHTML='<div class="msg-sys">💬 正在和 AI 讨论故事设定...<br>请在下方输入你的想法</div>';
    }else{
      area.innerHTML='<div class="msg-sys">📝 还没有章节<br>告诉 AI 你想写什么，它会自动开始创作</div>';
    }
    return;}
  var ch=currentBook.chapters[currentChapter];
  var html='<div class="chapter-heading">第'+(currentChapter+1)+'章 '+(ch.title||"")+'</div>';
  if(ch.content){ch.content.split("\n").forEach(function(p){if(p.trim())html+='<div class="chapter-text">'+esc(p)+'</div>';});}
  area.innerHTML=html;
  var wa=$("writeArea");wa.scrollTop=wa.scrollHeight;
}

// === AI Writing Engine ===
const WRITING_SYSTEM=`你是 NovelCraft AI，一个专业的小说创作助手。你能帮用户创作完整的小说。

你的工作流程：
第一阶段（讨论设定）：
- 先和用户讨论主角设定（名字、年龄、性格、背景、能力）
- 再讨论核心冲突和故事主线
- 然后讨论世界观和基调
- 最后确认结局走向
- 用轻松聊天的语气，像朋友一样讨论
- 一次不要问太多问题，分步骤来
- 等用户确认后，再说"设定已确认，我来生成大纲"

第二阶段（生成大纲）：
- 根据确认的设定生成 10-15 章大纲
- 每章有标题和简要情节概述

第三阶段（逐章创作）：
- 根据大纲逐章生成 2000-3000 字的完整内容
- 保持前后文连贯
- 润色和改写文本

写作规则：
- 使用中文写作，文笔优美
- 对话自然，情节紧凑
- 保持角色性格一致
- 章节之间有悬念和转折

重要：在讨论设定阶段，不要直接生成大纲或开始写内容。要一步步和用户确认。`;

function buildMessages(userMsg){
  var msgs=[{role:"system",content:WRITING_SYSTEM}];
  // Add context
  if(currentBook){
    var ctx="当前作品信息：\n书名："+currentBook.name+"\n风格："+(currentBook.genre||"未指定");
    if(currentBook.outline)ctx+="\n大纲："+currentBook.outline;
    if(currentBook.characters&&currentBook.characters.length)ctx+="\n角色："+JSON.stringify(currentBook.characters);
    if(currentBook.worldbuilding)ctx+="\n世界观："+currentBook.worldbuilding;
    if(currentBook.chapters&&currentBook.chapters.length){
      var last=currentBook.chapters[currentBook.chapters.length-1];
      ctx+="\n上一章："+(last.title||"")+"\n内容摘要："+(last.content?last.content.slice(-500):"");
    }
    msgs.push({role:"user",content:ctx});
    msgs.push({role:"assistant",content:"好的，我已了解当前作品信息。"});
  }
  msgs.push({role:"user",content:userMsg});
  return msgs;
}

async function callAI(msg){
  if(!apiKey){toast("⚠ 请配置密钥");return null;}
  var requestId=uid();
  return new Promise(function(resolve){
    window.onDeepSeekResult=function(id,content,usage){
      if(id===requestId){totalTokens+=usage||0;resolve(content);}
    };
    window.onDeepSeekError=function(id,err){
      if(id===requestId){toast("❌ "+err);resolve(null);}
    };
    NativeApi.callDeepSeek(apiKey,model,JSON.stringify(buildMessages(msg)),requestId);
  });
}

function parseAIResponse(text){
  try{
    // Try to extract JSON from response
    var m=text.match(/\{[\s\S]*\}/);
    if(m){
      var json=JSON.parse(m[0]);
      if(json.action)return json;
    }
  }catch(e){}
  return {action:"text",content:text};
}

// === Generate outline ===
async function generateOutline(book){
  toast("🧠 正在生成大纲...");
  var resp=await callAI("请为这部"+(book.genre||"")+"小说生成完整大纲。书名："+book.name+"\n\n要求：10-15章，每章有标题和简要情节概述。用 JSON 格式返回：{\"action\":\"outline\",\"title\":\"书名\",\"chapters\":[{\"num\":1,\"title\":\"章节名\",\"summary\":\"情节概述\"}]}");
  if(!resp)return;
  var parsed=parseAIResponse(resp);
  if(parsed.action==="outline"){
    book.outline=JSON.stringify(parsed);
    // Create chapter stubs
    if(parsed.chapters){book.chapters=parsed.chapters.map(function(c){return{title:c.title,summary:c.summary,content:""};});}
    save("books",books);currentChapter=0;renderChapter();
    bookPhase="writing";
    updateChips();
    toast("✅ 大纲已生成，可以开始创作了");
  }else{
    // Store raw outline
    book.outline=resp;save("books",books);
    bookPhase="writing";
    toast("✅ 已生成");
  }
}

// === Generate chapter ===
async function generateChapter(){
  if(writing)return;
  writing=true;showTyping();
  var book=currentBook;
  var chNum=book.chapters?book.chapters.length+1:1;
  var prompt="请生成第"+chNum+"章完整内容。";
  if(book.outline){
    try{var ol=JSON.parse(book.outline);if(ol.chapters&&ol.chapters[chNum-1])prompt+="\n章节标题："+ol.chapters[chNum-1].title+"\n情节："+ol.chapters[chNum-1].summary;}catch(e){}
  }
  prompt+="\n\n要求：2000-3000字，用 JSON 格式返回：{\"action\":\"chapter\",\"title\":\"章节标题\",\"content\":\"完整章节内容\"}";

  var resp=await callAI(prompt);
  hideTyping();writing=false;
  if(!resp){toast("❌ 生成失败");return;}

  var parsed=parseAIResponse(resp);
  if(parsed.action==="chapter"){
    if(!book.chapters)book.chapters=[];
    book.chapters.push({title:parsed.title||"第"+chNum+"章",content:parsed.content||resp});
    currentChapter=book.chapters.length-1;
    save("books",books);renderChapter();
    toast("✅ 第"+chNum+"章完成");
  }else{
    // Treat as plain text chapter
    if(!book.chapters)book.chapters=[];
    book.chapters.push({title:"第"+chNum+"章",content:resp});
    currentChapter=book.chapters.length-1;
    save("books",books);renderChapter();
    toast("✅ 已生成");
  }
}

// === Send message ===
async function sendWrite(){
  var input=$("writeInput");var text=input.value.trim();if(!text||writing)return;
  input.value="";autoResize(input);
  addMsgToArea("user",text);
  if(!currentBook){
    // No book yet - create one from prompt
    var book={id:uid(),name:text.slice(0,20),genre:"未分类",chapters:[],characters:[],worldbuilding:"",outline:"",createdAt:Date.now()};
    books.push(book);save("books",books);currentBook=book;$("bookTitle").textContent=book.name;
    bookPhase="consulting";
    updateChips();
    startConsultation(book);
    return;
  }
  // 咨询阶段：把用户回复发给AI继续讨论
  if(bookPhase==="consulting"){
    writing=true;showTyping();
    var resp=await callAI(text);hideTyping();writing=false;
    if(resp){
      addMsgToArea("ai",resp);
      // 检测AI是否确认设定完成，自动进入大纲阶段
      if(resp.indexOf("设定已确认")!==-1||resp.indexOf("生成大纲")!==-1){
        bookPhase="outline";
        updateChips();
        toast("📋 正在生成大纲...");
        setTimeout(function(){generateOutline(currentBook);},500);
      }
    }
    return;
  }
  // Check for commands
  if(text==="继续写"||text==="续写"){generateChapter();return;}
  if(text==="润色这段"||text==="改写"||text==="扩写"){
    var lastCh=currentBook.chapters&&currentBook.chapters.length?currentBook.chapters[currentBook.chapters.length-1]:null;
    if(lastCh&&lastCh.content){
      var prompt="请"+text.replace("这段","")+"以下内容，保持风格一致：\n\n"+lastCh.content.slice(-1000);
      writing=true;showTyping();
      var resp=await callAI(prompt);hideTyping();writing=false;
      if(resp){lastCh.content=resp;save("books",books);renderChapter();toast("✅ 已"+text);}
      return;
    }
  }
  // General chat about the book
  writing=true;showTyping();
  var resp=await callAI(text);hideTyping();writing=false;
  if(resp){addMsgToArea("ai",resp);}
}

function updateChips(){
  var chips=$("writeChips");if(!chips)return;
  if(bookPhase==="consulting"){
    chips.innerHTML='<button class="chip" onclick="sendCmd(\'确认设定\')">✅ 确认设定</button><button class="chip" onclick="sendCmd(\'换个方向\')">🔄 换个方向</button><button class="chip" onclick="sendCmd(\'再详细说说\')">💬 再详细说说</button>';
  }else if(bookPhase==="writing"||bookPhase==="outline"){
    chips.innerHTML='<button class="chip" onclick="sendCmd(\'继续写\')">续写</button><button class="chip" onclick="sendCmd(\'润色这段\')">润色</button><button class="chip" onclick="sendCmd(\'换个写法\')">改写</button><button class="chip" onclick="sendCmd(\'扩写\')">扩写</button>';
  }
}
function sendCmd(cmd){$("writeInput").value=cmd;sendWrite();}

function addMsgToArea(role,text){
  var area=$("chapterContent");
  var div=document.createElement("div");
  div.className=role==="user"?"msg-sys":"msg-ai";
  div.innerHTML=esc(text).replace(/\n/g,"<br>");
  area.appendChild(div);
  $("writeArea").scrollTop=$("writeArea").scrollHeight;
}

function showTyping(){
  var area=$("chapterContent");
  var d=document.createElement("div");d.className="typing";d.id="typing";
  d.innerHTML="<span></span><span></span><span></span>";
  area.appendChild(d);$("writeArea").scrollTop=$("writeArea").scrollHeight;
}
function hideTyping(){var t=$("typing");if(t)t.remove();}

// === Overlay ===
function showOverlay(title,label,type,placeholder,onConfirm){
  var overlay=document.createElement("div");overlay.className="overlay";
  var inputHtml=type==="select"
    ?"<select id='_ov_input' style='width:100%;padding:10px;background:#0b0b0b;color:#E8E8EC;border:1px solid #222;border-radius:8px'>"+placeholder.split(" ").map(function(s){return"<option>"+s+"</option>";}).join("")+"</select>"
    :"<input id='_ov_input' placeholder='"+esc(placeholder)+"' style='width:100%;padding:10px;background:#0b0b0b;color:#E8E8EC;border:1px solid #222;border-radius:8px'>";
  overlay.innerHTML='<div class="overlay-box"><p><b>'+esc(title)+'</b></p><div style="margin-bottom:14px"><label style="color:#6A6A6A;font-size:11px">'+esc(label)+'</label>'+inputHtml+'</div><div class="overlay-actions"><button onclick="this.closest(\'.overlay\').remove()">取消</button><button onclick="var v=document.getElementById(\'_ov_input\').value;this.closest(\'.overlay\').remove();">确定</button></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove();});
  overlay.querySelector(".overlay-actions button:last-child").onclick=function(){
    var v=document.getElementById("_ov_input").value;overlay.remove();onConfirm(v);
  };
  setTimeout(function(){document.getElementById("_ov_input")?.focus();},100);
}

// === Settings ===
function saveApiKey(){
  apiKey=$("cfgApiKey").value.trim();
  model=$("cfgModel").value;
  if(!apiKey){toast("⚠ 请输入密钥");return;}
  localStorage.setItem("ds_key",apiKey);
  localStorage.setItem("ds_model",model);
  toast("✅ 已保存");
}

// === Utils ===
function autoResize(el){el.style.height="auto";el.style.height=Math.min(el.scrollHeight,120)+"px";}

function toggleFold(el){
  var body=el.nextElementSibling;body.classList.toggle("open");
  el.querySelector(".fold-arrow").classList.toggle("open");
}

// === Balance check ===
function checkBalance(){
  if(!apiKey){toast("⚠ 请先配置密钥");return;}
  var info=$("balanceInfo");
  if(info)info.textContent="⏳ 正在查询...";
  var requestId=uid();
  window.onBalanceResult=function(id,status,msg){
    if(id===requestId){
      if(info){
        if(status==="ok"){
          info.innerHTML='<span style="color:#4CAF50">✅ '+msg+'</span>';
        }else{
          info.innerHTML='<span style="color:#F44336">❌ '+msg+'</span>';
        }
      }
    }
  };
  NativeApi.checkBalance(apiKey,requestId);
}

// === Init ===
function init(){
  apiKey=localStorage.getItem("ds_key")||"";
  model=localStorage.getItem("ds_model")||"deepseek-chat";
  renderBookshelf();
}

init();
