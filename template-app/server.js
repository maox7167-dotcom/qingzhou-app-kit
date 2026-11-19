/* =========================================================
   轻舟AI · 培训考核系统 —— 内网后端服务
   纯 Node 内置模块，零依赖。职责：
   1) 托管统一数据（data.json），30 人共享题库/试卷/成绩
   2) 提供 /api/state（拉取全量）、/api/save（保存，按 id 合并）
   3) 静态托管前端 HTML
   运行：  node server.js   然后浏览器访问 http://本机IP:3000
   ========================================================= */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn, execFileSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const DIR  = __dirname;
const DATA = path.join(DIR, 'data.json');
const HTML = path.join(DIR, 'app.html');

let state = {};
let rev = 0;

/* ---------- 种子数据（首次启动写入） ---------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function now(){ return new Date().toLocaleString('zh-CN'); }
function seed(){
  // 6 个管理员账号：admin01 ~ admin06，初始密码 admin888
  const adminNames = ['出题管理员','题库管理员','组卷管理员','评分管理员','考务管理员','系统管理员'];
  const users = [];
  for(let i=1;i<=6;i++){
    users.push({id:uid(),username:'admin'+String(i).padStart(2,'0'),password:'admin888',role:'admin',
      name:adminNames[i-1]||('管理员'+i),dept:'培训管理组'});
  }
  // 30 个客服账号：cs01 ~ cs30，初始密码 cs123456
  for(let i=1;i<=30;i++){
    users.push({id:uid(),username:'cs'+String(i).padStart(2,'0'),password:'cs123456',role:'cs',
      name:'客服'+String(i).padStart(2,'0'),dept:'一线客服'});
  }
  const questions = [
    {id:uid(),type:'choice',knowledge:'账号安全',difficulty:'基础',score:10,
     stem:'客户反馈账号在异地登录、疑似被盗，正确的第一处理动作是？',
     options:['立即要求客户转账验证身份','引导客户修改密码并开启设备锁，冻结异常登录','告知客户无法处理，转交技术','直接封禁账号'],
     answer:'1',analysis:'账号安全类投诉优先止损：引导改密+设备锁+冻结异常登录，避免要求转账等二次风险。'},
    {id:uid(),type:'judge',knowledge:'充值规则',difficulty:'基础',score:10,
     stem:'热血传奇的官方充值渠道仅限游戏内与官网，任何第三方低价代充都属违规，客服应提示风险并引导官方渠道。',
     answer:'true',analysis:'代充多涉及黑产/盗刷，易致封号与资金损失，客服须明确提示风险并引导官方渠道。'},
    {id:uid(),type:'essay',knowledge:'投诉处理',difficulty:'进阶',score:20,
     stem:'请简述当客户因「装备无故消失」情绪激动投诉时，客服的标准处理流程与话术要点。',
     answer:'安抚情绪→核实账号与日志→区分正常消耗/BUG/盗号→可恢复的协助恢复并说明时效→不可恢复的致歉+补偿方案→记录案例归档。',
     analysis:'评分要点：①先共情安抚不急于辩解；②必须先核实日志再下结论；③区分原因给出不同处置；④闭环补偿与归档。缺任一点扣对应分。'},
    {id:uid(),type:'choice',knowledge:'违规处理',difficulty:'实战',score:15,
     stem:'检测到客户在公屏发布线下交易引流信息，且为第三次违规，按规则应？',
     options:['口头提醒','禁言1天','禁言7天并标记重点观察','永久封禁'],
     answer:'2',analysis:'三次违规对应阶梯处罚：禁言7天并标记观察，永久封禁需更重违规层级，避免过度处罚引发投诉。'}
  ];
  const scope = {id:uid(),title:'新客服上岗认证（第一周）考试范围',period:'2026年10月',examId:'',createdAt:now(),
    content:'本期考试范围（客服业务）：\n1. 账号安全：盗号处理、改密与设备锁引导，禁止要求客户转账验证。\n2. 充值规则：仅官方渠道，代充属违规须提示风险。\n3. 投诉处理：装备消失类工单的标准流程与话术要点。\n4. 违规处理：公屏违规的阶梯处罚标准。'};
  const exam = {id:uid(),title:'新客服上岗认证（第一周）',passScore:60,totalScore:55,
    duration:30,questionIds:questions.map(q=>q.id),createdAt:now(),blueprint:'基础2·进阶1·实战1',
    status:'published',publishNote:'',publishedAt:now(),scopeId:scope.id};
  scope.examId = exam.id;
  state = {
    ywx_users:users, ywx_questions:questions, ywx_scopes:[scope], ywx_exams:[exam],
    ywx_materials:[], ywx_attempts:[], ywx_settings:{apiBase:'',apiKey:'',model:'gpt-4o-mini',enabled:false}
  };
  rev = 1;
}

/* ---------- 持久化（原子写） ---------- */
function persist(){
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({rev, state}));
  fs.renameSync(tmp, DATA);
}
function loadStore(){
  if(fs.existsSync(DATA)){
    try{ const j = JSON.parse(fs.readFileSync(DATA,'utf8')); rev = j.rev||0; state = j.state||{}; return; }
    catch(e){ console.error('data.json 解析失败，重新初始化'); }
  }
  seed(); persist();
}

/* ---------- 保存合并：答卷按 id 追加/覆盖，其余整键覆盖 ---------- */
function mergeKey(key, val){
  const cur = state[key];
  if((key === 'ywx_attempts' || key === 'ywx_wishes') && Array.isArray(cur) && Array.isArray(val)){
    const m = new Map(cur.map(x=>[x.id,x]));
    val.forEach(x=>m.set(x.id,x));
    state[key] = [...m.values()];
  } else {
    state[key] = val;
  }
  rev++;
}

/* ---------- 工具 ---------- */
function sendJSON(res, obj, code=200){
  const b = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(b);
}
function readBody(req){ return new Promise((resolve)=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{resolve(JSON.parse(d||'{}'))}catch(e){resolve({})}});}); }

/* ============================================================
   内置许愿上报地址（写死在封装包里）
   ------------------------------------------------------------
   客户装上即生效，不用做任何配置；即使不在同一局域网，
   只要客户电脑能上网，许愿就会直接推送到你的群。
   - 留空字符串 = 不内置，退回「设置页填写地址」的旧模式
   - 内置时客户端的设置无法覆盖（防止被改到别处）
   - 测试可用环境变量 QW_WISH_HOOK 临时覆盖
   ============================================================ */
const BUILTIN_WISH_HOOK = (function(){
  // 分段存放 + base64，避免被直接搜索到明文地址；运行时拼回
  try{
    const p = [
      /* 把你的企业微信群机器人 webhook 切成 3~5 段 base64 填在这里，
         运行时会自动拼回。留空 = 不内置，退回「设置页填写地址」模式 */
    ];
    return Buffer.from(p.join(''), 'base64').toString('utf8').trim();
  }catch(e){ return ''; }
})();
const BUILTIN_WISH_TYPE = 'wecom';

/* 往外发 JSON（许愿上报用）：Node 端发请求没有跨域限制 */
function postJSON(target, payload, timeout){
  return new Promise((resolve, reject)=>{
    let u; try{ u = new URL(target); }catch(e){ return reject(new Error('上报地址不是合法 URL')); }
    if(u.protocol !== 'http:' && u.protocol !== 'https:'){ return reject(new Error('上报地址必须是 http(s) 开头')); }
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    const rq = lib.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''), method: 'POST',
      headers: {'Content-Type':'application/json; charset=utf-8','Content-Length':buf.length}
    }, (rs)=>{
      let b=''; rs.on('data',c=>b+=c); rs.on('end',()=>resolve({status:rs.statusCode, body:b}));
    });
    rq.setTimeout(timeout || 6000, ()=>{ rq.destroy(new Error('上报超时（6 秒）')); });
    rq.on('error', reject);
    rq.write(buf); rq.end();
  });
}

/* 本机局域网 IPv4，优先真实内网段 */
function lanIPs(){
  const os = require('os');
  const nets = os.networkInterfaces(); const ips = [];
  for(const k in nets){
    (nets[k] || []).forEach(n=>{
      if(n.family === 'IPv4' && !n.internal && !/^169\.254\./.test(n.address)) ips.push(n.address);
    });
  }
  const rank = x => /^192\.168\./.test(x) ? 0 : /^10\./.test(x) ? 1
                   : /^172\.(1[6-9]|2\d|3[01])\./.test(x) ? 2 : 3;
  return ips.sort((a,b)=> rank(a) - rank(b) || a.localeCompare(b));
}

/* ============================================================
   技能抓取：服务端代拉 GitHub 上的 SKILL.md
   ------------------------------------------------------------
   浏览器直接拉 raw.githubusercontent.com 常被跨域/网络拦住，
   交给服务端取更稳。只允许公网 http(s)，禁止内网地址（防 SSRF）。
   ============================================================ */
function isPrivateHost(h){
  const host = String(h || '').toLowerCase();
  if(!host) return true;
  if(host === 'localhost' || host === '[::1]' || host === '::1') return true;
  if(/\.local$|\.internal$/.test(host)) return true;
  if(/^127\./.test(host) || /^0\./.test(host) || /^10\./.test(host)) return true;
  if(/^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if(/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}
function httpGetText(target, timeout, limit){
  return new Promise((resolve, reject)=>{
    let u; try{ u = new URL(target); }catch(e){ return reject(new Error('链接不合法')); }
    if(u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('只支持 http(s) 链接'));
    if(isPrivateHost(u.hostname)) return reject(new Error('不允许访问内网地址'));
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const rq = lib.get({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {'User-Agent':'QingzhouAI/3.4.1','Accept':'text/plain,*/*'}
    }, (rs)=>{
      if(rs.statusCode >= 300 && rs.statusCode < 400 && rs.headers.location){
        rs.resume();
        let next; try{ next = new URL(rs.headers.location, target).toString(); }catch(e){ return reject(new Error('重定向地址不合法')); }
        return httpGetText(next, timeout, limit).then(resolve, reject);
      }
      if(rs.statusCode !== 200){ rs.resume(); return reject(new Error('HTTP ' + rs.statusCode)); }
      let n = 0; const chunks = [];
      rs.on('data', c=>{
        n += c.length;
        if(n > limit){ rq.destroy(); return reject(new Error('文件过大（超过 ' + Math.round(limit/1024) + 'KB）')); }
        chunks.push(c);
      });
      rs.on('end', ()=> resolve(Buffer.concat(chunks).toString('utf8')));
      rs.on('error', reject);
    });
    rq.setTimeout(timeout || 12000, ()=>{ rq.destroy(new Error('抓取超时（12 秒）')); });
    rq.on('error', reject);
  });
}
/* GitHub 文件页 → 可用地址；jsDelivr 走 CDN 国内更快，放第一位，raw 兜底 */
function ghCandidates(raw){
  const url = String(raw || '').trim();
  let m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i);
  if(m){
    const user = m[1], repo = m[2], br = m[3], p = m[4];
    return ['https://cdn.jsdelivr.net/gh/' + user + '/' + repo + '@' + br + '/' + p,
            'https://raw.githubusercontent.com/' + user + '/' + repo + '/' + br + '/' + p];
  }
  m = url.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
  if(m){
    const user = m[1], repo = m[2], br = m[3], p = m[4];
    return ['https://cdn.jsdelivr.net/gh/' + user + '/' + repo + '@' + br + '/' + p, url];
  }
  return [url];
}

/* ================= 本地小模型（llama.cpp）管理 =================
   原则：
   1) 模型不进 exe，放独立目录（默认 D:\轻舟AI模型），换模型不用重打包
   2) 服务由本进程拉起，本进程退出时一并回收，不留僵尸进程占内存
   3) 只绑 127.0.0.1，端口限 1024~65535，不接受外来地址
   4) 只按白名单运行 llama-server.exe，不执行模型目录里的其它任何东西
   =============================================================== */
const MODEL_DIR_NAME = '轻舟AI模型';
/* 模型目录：优先 D 盘（几百 M~2G 不占系统盘），没有 D 盘就退到 E 盘，再不行就放程序数据目录 */
function defaultModelDir(){
  try { if(fs.existsSync('D:\\')) return 'D:\\' + MODEL_DIR_NAME; } catch(e){}
  try { if(fs.existsSync('E:\\')) return 'E:\\' + MODEL_DIR_NAME; } catch(e){}
  return path.join(DIR, 'model');
}
/* 内置的 llama-server.exe 目录（由桌面端启动器释放过来，便携版没有则为空） */
const BUILTIN_LLAMA_DIR = process.env.YWX_LLAMA_DIR || path.join(DIR, 'llama');
let LOCAL_PROC = null;
let LOCAL_INFO = { pid: 0, port: 0, model: '', startedAt: 0 };

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* 在目录下最多 depth 层内按正则找文件 */
function findFiles(root, re, maxDepth, depth){
  depth = depth || 0;
  const out = [];
  if(depth > maxDepth) return out;
  let list = [];
  try { list = fs.readdirSync(root, { withFileTypes: true }); } catch(e){ return out; }
  for(const d of list){
    const fp = path.join(root, d.name);
    if(d.isDirectory()){
      const sub = findFiles(fp, re, maxDepth, depth + 1);
      for(const x of sub) out.push(x);
    } else if(re.test(d.name)){
      let size = 0;
      try { size = fs.statSync(fp).size; } catch(e){}
      out.push({ name: d.name, path: fp, size: size, mb: Math.round(size / 1048576 * 10) / 10 });
    }
  }
  return out;
}

function gpuInfo(){
  try {
    const out = execFileSync('nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader'],
      { timeout: 2500, encoding: 'utf8', windowsHide: true });
    return String(out).trim().split(/\r?\n/).filter(Boolean).map(function(line){
      const p = line.split(',').map(function(x){ return x.trim(); });
      return { name: p[0], memMB: parseInt(p[1], 10) || 0 };
    });
  } catch(e){ return []; }
}

/* ================= 模型下载（客户自己下最容易翻车，这里代劳） =================
   原则：
   1) 只认下面这张表里的档位，不接受任何外来 URL——避免被当成任意文件下载器
   2) 先写 xxx.gguf.part，下完再改名，中断了能接着续
   3) 同一时间只跑一个任务，重复点不会开出多条连接
   ================================================================= */
const MODEL_CATALOG = {
  '0.6b': { tier:'0.6b', label:'Qwen3-0.6B（Q4_K_M）', file:'Qwen3-0.6B-Q4_K_M.gguf', size:396705472,
    url:'https://modelscope.cn/models/unsloth/Qwen3-0.6B-GGUF/resolve/master/Qwen3-0.6B-Q4_K_M.gguf' },
  '1.7b': { tier:'1.7b', label:'Qwen3-1.7B（Q4_K_M）', file:'Qwen3-1.7B-Q4_K_M.gguf', size:1107409472,
    url:'https://modelscope.cn/models/unsloth/Qwen3-1.7B-GGUF/resolve/master/Qwen3-1.7B-Q4_K_M.gguf' },
  '4b':   { tier:'4b',   label:'Qwen3-4B（Q4_K_M）',   file:'Qwen3-4B-Q4_K_M.gguf',   size:2497280256,
    url:'https://modelscope.cn/models/Qwen/Qwen3-4B-GGUF/resolve/master/Qwen3-4B-Q4_K_M.gguf' }
};

let DL = { key:'', file:'', dir:'', total:0, got:0, state:'idle', error:'', startedAt:0,
           req:null, speed:0, lastTick:0, lastGot:0, canceled:false };

function dlSnapshot(){
  const percent = DL.total ? Math.min(100, Math.round(DL.got / DL.total * 1000) / 10) : 0;
  return { ok:true, key:DL.key, file:DL.file, dir:DL.dir, total:DL.total, got:DL.got,
    percent:percent, state:DL.state, error:DL.error, speed:Math.round(DL.speed || 0),
    startedAt:DL.startedAt };
}

/* 跟随最多 5 次跳转（ModelScope 会 302 到 CDN） */
function openFollow(urlStr, headers, hops){
  hops = hops || 0;
  return new Promise(function(resolve, reject){
    if(hops > 5) return reject(new Error('下载地址跳转次数过多'));
    let u;
    try { u = new URL(urlStr); } catch(e){ return reject(new Error('下载地址不合法')); }
    const lib = u.protocol === 'http:' ? require('http') : require('https');
    const rq = lib.get(u, { headers: headers || {} }, function(rs){
      const code = rs.statusCode || 0;
      if([301,302,303,307,308].indexOf(code) >= 0 && rs.headers.location){
        rs.resume();
        let nx;
        try { nx = new URL(rs.headers.location, u).href; } catch(e){ return reject(new Error('跳转地址不合法')); }
        return resolve(openFollow(nx, headers, hops + 1));
      }
      resolve({ req: rq, res: rs });
    });
    rq.setTimeout(45000, function(){ rq.destroy(new Error('连接模型站超时（45 秒）')); });
    rq.on('error', reject);
  });
}

async function startDownload(key, dir){
  const c = MODEL_CATALOG[key];
  if(!c) throw new Error('不支持这个模型档位：' + key);
  if(DL.state === 'running') throw new Error('已经有一个下载任务在跑，等它完成或先取消');
  dir = String(dir || '').trim() || defaultModelDir();
  try { fs.mkdirSync(dir, { recursive:true }); }
  catch(e){ throw new Error('模型目录创建失败：' + dir + '（' + e.message + '）'); }

  const target = path.join(dir, c.file);
  const part = target + '.part';

  /* 已经下好了，直接返回 */
  if(fs.existsSync(target) && fs.statSync(target).size === c.size){
    DL = { key:key, file:c.file, dir:dir, total:c.size, got:c.size, state:'done', error:'',
           startedAt:Date.now(), req:null, speed:0, lastTick:0, lastGot:0, canceled:false };
    return dlSnapshot();
  }

  let startAt = 0;
  try { if(fs.existsSync(part)) startAt = fs.statSync(part).size; } catch(e){}
  if(startAt >= c.size){ try { fs.unlinkSync(part); } catch(e){} startAt = 0; }

  DL = { key:key, file:c.file, dir:dir, total:c.size, got:startAt, state:'running', error:'',
         startedAt:Date.now(), req:null, speed:0, lastTick:Date.now(), lastGot:startAt, canceled:false };

  const headers = { 'User-Agent':'QingzhouAI/3.4.1', 'Accept':'*/*' };
  if(startAt > 0) headers.Range = 'bytes=' + startAt + '-';

  let opened;
  try { opened = await openFollow(c.url, headers); }
  catch(e){
    DL.state = 'error';
    DL.error = '连不上模型站：' + e.message + '（检查网络或稍后再试）';
    DL.req = null;
    return dlSnapshot();
  }
  const rq = opened.req, rs = opened.res, code = rs.statusCode || 0;

  if(code === 416){
    rs.resume();
    try {
      if(fs.existsSync(part) && fs.statSync(part).size >= c.size - 4096){
        fs.renameSync(part, target);
        DL.state = 'done'; DL.got = c.size; DL.total = c.size; DL.req = null;
        return dlSnapshot();
      }
      fs.unlinkSync(part);
    } catch(e){}
    DL.state = 'error'; DL.error = '续传位置无效，已清空，请重新点下载'; DL.req = null;
    return dlSnapshot();
  }
  if(code !== 200 && code !== 206){
    rs.resume();
    DL.state = 'error';
    DL.error = '下载源返回 HTTP ' + code + '（可能被网络限制，稍后再试）';
    DL.req = null;
    return dlSnapshot();
  }

  /* 只有 206 才能接着写；回 200 说明不支持断点，只能从头来 */
  const append = (code === 206);
  if(!append){ startAt = 0; DL.got = 0; DL.lastGot = 0; }
  const ws = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
  DL.req = rq;

  rs.on('data', function(ch){
    DL.got += ch.length;
    const t = Date.now();
    if(t - DL.lastTick >= 1000){
      DL.speed = (DL.got - DL.lastGot) / ((t - DL.lastTick) / 1000);
      DL.lastTick = t; DL.lastGot = DL.got;
    }
  });
  rs.pipe(ws);

  return await new Promise(function(resolve){
    let settled = false;
    function fin(state, err){
      if(settled) return;
      settled = true;
      DL.state = DL.canceled ? 'canceled' : state;
      if(err && !DL.canceled) DL.error = err;
      DL.speed = 0;
      DL.req = null;
      resolve(dlSnapshot());
    }
    ws.on('finish', function(){
      let have = 0;
      try { have = fs.statSync(part).size; } catch(e){}
      if(have === c.size){
        try { fs.renameSync(part, target); }
        catch(e){ return fin('error', '文件改名失败：' + e.message + '（可能被其它程序占用）'); }
        DL.got = c.size; DL.total = c.size;
        fin('done');
      } else {
        fin('error', '文件不完整（已下 ' + (have/1048576).toFixed(1) + ' / ' + (c.size/1048576).toFixed(1)
          + ' MB），再点一次「继续下载」可接着下');
      }
    });
    ws.on('error', function(e){ fin('error', '写文件失败：' + e.message); });
    rs.on('error', function(e){ try{ ws.end(); }catch(_){} fin('error', '网络中断：' + e.message); });
    rq.on('error', function(e){ try{ ws.end(); }catch(_){} fin('error', '网络中断：' + e.message); });
    rs.on('aborted', function(){ try{ ws.end(); }catch(_){} fin('error', '连接被中断（可再点一次续传）'); });
  });
}

function cancelDownload(){
  const wasRunning = (DL.state === 'running');
  DL.canceled = true;
  if(DL.req){ try { DL.req.destroy(); } catch(e){} }
  DL.req = null;
  DL.state = 'canceled';
  DL.speed = 0;
  return { ok:true, canceled:wasRunning, got:DL.got, file:DL.file };
}

/* 环境自检：返回目录、模型清单、机器配置、推荐档位 */
function localScan(dir){
  const defDir = defaultModelDir();
  dir = String(dir || '').trim() || defDir;
  const r = { ok: true, dir: dir, defaultDir: defDir, exists: false, exe: null, exeBuiltin: false,
              models: [], sys: {}, recommend: null, notes: [], download: dlSnapshot() };
  r.exists = fs.existsSync(dir);
  if(r.exists){
    const exes = findFiles(dir, /^llama-server\.exe$/i, 2, 0);
    if(exes.length) r.exe = exes[0].path;
    const ggs = findFiles(dir, /\.gguf$/i, 3, 0);
    ggs.sort(function(a, b){ return b.size - a.size; });
    /* 标出每个模型对应哪一档、是否完整（同名文件大小不符说明是下了一半的） */
    ggs.forEach(function(m){
      for(const k in MODEL_CATALOG){
        const c = MODEL_CATALOG[k];
        if(m.name === c.file){
          m.catalogKey = k;
          m.complete = (m.size === c.size);
          break;
        }
      }
    });
    r.models = ggs;
  }
  /* 目录里没有服务程序就用随软件内置的那份，客户不用自己找 llama.cpp */
  if(!r.exe){
    try {
      if(fs.existsSync(BUILTIN_LLAMA_DIR)){
        const bi = findFiles(BUILTIN_LLAMA_DIR, /^llama-server\.exe$/i, 2, 0);
        if(bi.length){ r.exe = bi[0].path; r.exeBuiltin = true; }
      }
    } catch(e){}
  }
  r.sys.cores = os.cpus().length;
  r.sys.cpu = String((os.cpus()[0] || {}).model || '').replace(/\s+/g, ' ').trim().slice(0, 46);
  r.sys.memGB = Math.round(os.totalmem() / 1073741824 * 10) / 10;
  r.sys.freeGB = Math.round(os.freemem() / 1073741824 * 10) / 10;
  r.sys.arch = process.arch;
  r.sys.gpus = gpuInfo();
  const gpuMax = r.sys.gpus.reduce(function(m, g){ return Math.max(m, g.memMB || 0); }, 0);
  r.sys.gpuMaxMB = gpuMax;
  r.sys.diskFreeGB = diskFreeGB(r.exists ? dir : path.parse(path.resolve(dir)).root);

  let tier = 'none', label = '建议用在线接口', tokps = 0;
  if(gpuMax >= 5500){ tier = '4b';   label = '4B · 显卡加速';  tokps = 40; }
  else if(gpuMax >= 2600){ tier = '1.7b'; label = '1.7B · 显卡加速'; tokps = 45; }
  else if(r.sys.memGB >= 8){ tier = '0.6b'; label = '0.6B · CPU 推理'; tokps = 12; }
  r.recommend = { tier: tier, label: label, tokPerSec: tokps, gpuMaxMB: gpuMax };

  if(!r.exe) r.notes.push('没找到推理服务程序，重新安装一下桌面版即可（安装包已内置）');
  if(r.exists && !r.models.length) r.notes.push('还没下载模型，点下面任一本地档的「下载」即可');
  if(!r.exists) r.notes.push('模型目录还没建，下载时会自动创建');
  r.plans = buildPlans(r);
  return r;
}

/* 磁盘剩余空间（拿不到就返回 null，不阻塞自检） */
function diskFreeGB(p){
  try {
    const st = fs.statfsSync(p);
    return Math.round(st.bavail * st.bsize / 1073741824 * 10) / 10;
  } catch(e){ return null; }
}

/* 按机器配置算 4 档方案的适配度，前端只负责渲染
   fit: good 推荐 / ok 能用但慢 / bad 不建议
   ready: 模型文件是否已在目录（在就免下载） */
function buildPlans(r){
  const gpuMax = r.sys.gpuMaxMB || 0;
  /* 系统会吃掉一点，16G 机器报 15.9G、8G 报 7.9G，所以按 0.5G 向下取整判档 */
  const mem = Math.floor((r.sys.memGB || 0) * 2) / 2;
  const models = r.models || [];
  /* 优先按官方文件名精确对上；对上再看大小是否完整。认不出来才退回正则（兼容用户自己放的别的量化） */
  function pick(re, tier){
    for(const m of models){ if(tier && m.catalogKey === tier && m.complete !== false) return m; }
    for(const m of models){ if(m.complete !== false && re.test(m.name)) return m; }
    return null;
  }
  function localPlan(o){
    const c = MODEL_CATALOG[o.tier];
    const m = pick(o.re, o.tier);
    const mb = Math.round(c.size / 1048576);
    return { key:o.key, engine:'local', tier:o.tier,
      name:'本地 · ' + o.title, sub:c.label + ' · ' + mb + ' MB',
      tag:o.tag, fit:o.fit, ready:!!m, modelPath:m ? m.path : '',
      file:c.file, sizeMB:mb, downloadKey:o.tier,
      need:o.need, speed:o.speed, mem:o.mem,
      tip:m ? '模型已在目录里，可直接启动'
            : ('点卡片上的「下载」，约 ' + mb + ' MB，下完自动启动') };
  }

  const plans = [];

  plans.push({ key:'online', engine:'online', name:'在线 API', sub:'云端大模型（DeepSeek / 通义等）',
    tag:'质量最好', fit:'good', ready:true, need:'联网 + API Key，约 2 分钱/套',
    speed:'30 题约 7 秒', mem:'不吃本机内存', tip:'配置在「大模型接口」里，填 Base 和 Key 即可' });

  plans.push(localPlan({ key:'local-06', tier:'0.6b', title:'0.6B', re:/0[._]6\s*b/i, tag:'轻量离线',
    fit:(mem >= 7.5 ? 'good' : (mem >= 3.5 ? 'ok' : 'bad')),
    need:'内存 ≥ 4G，硬盘留 1G',
    speed:(gpuMax >= 2600 ? '30 题约 40 秒（显卡）' : '30 题约 3 分钟（纯 CPU）'),
    mem:'运行时约占 1G 内存' }));

  const f17 = (gpuMax >= 2600 && mem >= 7.5) || mem >= 11.5 ? 'good' : (mem >= 7.5 ? 'ok' : 'bad');
  plans.push(localPlan({ key:'local-17', tier:'1.7b', title:'1.7B', re:/1[._]7\s*b/i, tag:'质量/速度均衡', fit:f17,
    need:'内存 ≥ 8G，硬盘留 1.5G',
    speed:(gpuMax >= 2600 ? '30 题约 1 分钟（显卡）' : '30 题约 5 分钟（纯 CPU）'),
    mem:'运行时约占 2.2G 内存' }));

  let f4 = 'bad';
  if(gpuMax >= 5500 && mem >= 15) f4 = 'good';
  else if(gpuMax >= 5500 || mem >= 15) f4 = 'ok';
  plans.push(localPlan({ key:'local-4b', tier:'4b', title:'4B', re:/(^|[^0-9.])4\s*b([^0-9]|$)/i, tag:'离线质量最好', fit:f4,
    need:'显存 ≥ 6G 或内存 ≥ 16G，硬盘留 3G',
    speed:(gpuMax >= 5500 ? '30 题约 50 秒（显卡）' : '30 题约 8 分钟（纯 CPU，不推荐）'),
    mem:'运行时约占 4G 内存' }));

  plans.push({ key:'rule', engine:'rule', name:'仅规则引擎', sub:'不调模型，模板化组题',
    tag:'零成本秒出', fit:'ok', ready:true, need:'无任何硬件要求',
    speed:'30 题 0.1 秒', mem:'不吃内存', tip:'适合制度、流程、话术类资料，题目偏模板化' });

  /* 首选：推荐档的模型已下载就推本地，否则推在线 */
  let bestKey = 'online';
  const rt = plans.filter(function(p){ return p.tier && p.tier === r.recommend.tier; })[0];
  if(rt && rt.ready && rt.fit === 'good') bestKey = rt.key;
  plans.forEach(function(p){ p.best = (p.key === bestKey); });
  return plans;
}

/* GET 探测本地服务是否在跑 */
function localPing(port, timeoutMs){
  return new Promise(function(resolve){
    let done = false;
    function fin(v){ if(!done){ done = true; resolve(v); } }
    let req;
    try {
      req = http.request({ host: '127.0.0.1', port: port, path: '/v1/models', method: 'GET' }, function(res){
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', function(c){ buf += c; });
        res.on('end', function(){
          let j = null;
          try { j = JSON.parse(buf); } catch(e){}
          fin({ alive: res.statusCode === 200, status: res.statusCode,
                models: ((j && j.data) || []).map(function(x){ return x.id; }) });
        });
      });
    } catch(e){ return fin({ alive: false, status: 0, models: [] }); }
    req.setTimeout(timeoutMs || 1500, function(){ try{ req.destroy(); }catch(e){} fin({ alive: false, status: 0, models: [] }); });
    req.on('error', function(){ fin({ alive: false, status: 0, models: [] }); });
    req.end();
  });
}

/* POST 转发到本地模型（长超时，模型慢也不掐断） */
function localPost(port, pathName, bodyObj, timeoutMs){
  return new Promise(function(resolve, reject){
    const data = JSON.stringify(bodyObj || {});
    const req = http.request({
      host: '127.0.0.1', port: port, path: pathName, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, function(res){
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function(c){ buf += c; });
      res.on('end', function(){
        let j = null;
        try { j = JSON.parse(buf); } catch(e){}
        resolve({ status: res.statusCode, body: buf, json: j });
      });
    });
    req.setTimeout(timeoutMs || 600000, function(){ try{ req.destroy(new Error('本地模型响应超时')); }catch(e){} });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* 拉起 llama-server：参数保守，优先 GPU，失败由 llama.cpp 自己回落 CPU */
async function localStart(cfg){
  const exe = String(cfg.exe || '').trim();
  const model = String(cfg.model || '').trim();
  const port = parseInt(cfg.port, 10) || 8090;
  if(!exe || !fs.existsSync(exe)) throw new Error('找不到 llama-server.exe，请先点「环境自检」确认目录');
  if(!model || !fs.existsSync(model)) throw new Error('找不到模型文件（.gguf）');
  if(!(port >= 1024 && port <= 65535)) throw new Error('端口需在 1024~65535 之间');

  const already = await localPing(port, 1200);
  if(already.alive) return { ok: true, already: true, port: port, models: already.models };

  if(LOCAL_PROC && !LOCAL_PROC.killed){ try{ LOCAL_PROC.kill(); } catch(e){} LOCAL_PROC = null; }

  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port),
                '-c', '4096', '-ngl', '99', '-t', String(threads), '-np', '1', '--no-warmup'];
  const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore', windowsHide: true });
  LOCAL_PROC = child;
  let dead = '';
  child.on('exit', function(code){
    dead = 'llama-server 已退出（代码 ' + code + '），常见原因：模型文件损坏、显存/内存不足、端口被占用';
    if(LOCAL_PROC === child) LOCAL_PROC = null;
  });
  child.on('error', function(e){ dead = '启动失败：' + e.message; });

  const t0 = Date.now();
  while(Date.now() - t0 < 90000){
    await sleep(1200);
    if(dead) throw new Error(dead);
    const p = await localPing(port, 1500);
    if(p.alive){
      LOCAL_INFO = { pid: child.pid, port: port, model: path.basename(model), startedAt: Date.now() };
      return { ok: true, pid: child.pid, port: port, models: p.models, warmupMs: Date.now() - t0 };
    }
  }
  try { child.kill(); } catch(e){}
  LOCAL_PROC = null;
  throw new Error('启动后 90 秒内没就绪：模型可能太大、显存不足，或首次加载需要更久');
}

function localStop(){
  const had = !!(LOCAL_PROC && !LOCAL_PROC.killed);
  if(had){ try{ LOCAL_PROC.kill(); } catch(e){} }
  LOCAL_PROC = null;
  LOCAL_INFO = { pid: 0, port: 0, model: '', startedAt: 0 };
  return { ok: true, stopped: had };
}

/* 主进程退出时回收，避免残留进程继续吃内存 */
function killLocalOnExit(){ if(LOCAL_PROC && !LOCAL_PROC.killed){ try{ LOCAL_PROC.kill(); } catch(e){} } }
process.on('exit', killLocalOnExit);
process.on('SIGINT', function(){ killLocalOnExit(); process.exit(0); });
process.on('SIGTERM', function(){ killLocalOnExit(); process.exit(0); });

/* ---------- 路由 ---------- */
const server = http.createServer(async (req,res)=>{
  const url = req.url.split('?')[0];
  try{
    if(url === '/api/state' && req.method === 'GET'){
      return sendJSON(res, {rev, data:state});
    }
    if(url === '/api/save' && req.method === 'POST'){
      const {key, value} = await readBody(req);
      if(!key){ return sendJSON(res, {error:'missing key'}, 400); }
      mergeKey(key, value);
      persist();
      return sendJSON(res, {rev});
    }
    // 局域网访问信息：界面显示「同事访问地址」
    if(url === '/api/netinfo' && req.method === 'GET'){
      const os = require('os');
      return sendJSON(res, {port: Number(PORT), ips: lanIPs(), hostname: os.hostname()});
    }
    // ===== 本地小模型 =====
    if(url === '/api/local/scan' && req.method === 'GET'){
      const q = new URLSearchParams((req.url.split('?')[1] || ''));
      return sendJSON(res, localScan(q.get('dir')));
    }
    if(url === '/api/local/status' && req.method === 'GET'){
      const q = new URLSearchParams((req.url.split('?')[1] || ''));
      const port = parseInt(q.get('port'), 10) || 8090;
      const p = await localPing(port, 1500);
      return sendJSON(res, { ok: true, alive: p.alive, port: port, models: p.models,
        proc: !!(LOCAL_PROC && !LOCAL_PROC.killed), pid: (LOCAL_PROC || {}).pid || 0,
        info: LOCAL_INFO });
    }
    if(url === '/api/local/start' && req.method === 'POST'){
      const b = await readBody(req);
      try { return sendJSON(res, await localStart(b)); }
      catch(e){ return sendJSON(res, { ok: false, error: String((e && e.message) || e) }); }
    }
    if(url === '/api/local/stop' && req.method === 'POST'){
      return sendJSON(res, localStop());
    }
    // 打开（必要时创建）模型目录：只调 explorer.exe，不执行目录里任何文件
    if(url === '/api/local/opendir' && req.method === 'POST'){
      const b = await readBody(req);
      const dir = String(b.dir || '').trim() || defaultModelDir();
      let created = false;
      try {
        if(!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); created = true; }
        /* 自动化测试时置 YWX_NO_OPEN=1，只建目录不弹窗 */
        if(process.env.YWX_NO_OPEN !== '1'){
          try { execFileSync('explorer.exe', [dir], { windowsHide: true, timeout: 4000 }); }
          catch(e){ /* explorer 常以非 0 退出，属正常 */ }
        }
        return sendJSON(res, { ok: true, dir: dir, created: created });
      } catch(e){
        return sendJSON(res, { ok: false, error: String((e && e.message) || e) });
      }
    }
    /* 模型下载：只有这三档，白名单外的 key 一律拒 */
    if(url === '/api/local/catalog' && req.method === 'GET'){
      return sendJSON(res, { ok: true, dir: defaultModelDir(), items: Object.keys(MODEL_CATALOG).map(function(k){
        const c = MODEL_CATALOG[k];
        return { key:k, label:c.label, file:c.file, size:c.size, mb:Math.round(c.size / 1048576) };
      }) });
    }
    /* 下载：立刻返回，真正下载在后台跑，前端轮询 /status 拿进度（否则要挂 5 分钟） */
    if(url === '/api/local/download' && req.method === 'POST'){
      const b = await readBody(req);
      const key = String(b.key || '').trim();
      const dir = String(b.dir || '').trim();
      const c = MODEL_CATALOG[key];
      if(!c) return sendJSON(res, { ok:false, error:'不支持这个模型档位：' + key });
      if(DL.state === 'running') return sendJSON(res, { ok:false, error:'已经有下载任务在跑，等它完成或先取消' });
      const useDir = dir || defaultModelDir();
      const target = path.join(useDir, c.file);
      if(fs.existsSync(target) && fs.statSync(target).size === c.size){
        return sendJSON(res, { ok:true, state:'done', key:key, file:c.file, dir:useDir,
          total:c.size, got:c.size, percent:100 });
      }
      sendJSON(res, { ok:true, state:'starting', key:key, file:c.file, dir:useDir, total:c.size });
      startDownload(key, dir).catch(function(e){
        DL.state = 'error';
        DL.error = String((e && e.message) || e);
      });
      return;
    }
    if(url === '/api/local/download/status' && req.method === 'GET'){
      return sendJSON(res, dlSnapshot());
    }
    if(url === '/api/local/download/cancel' && req.method === 'POST'){
      return sendJSON(res, cancelDownload());
    }
    if(url === '/api/local/chat' && req.method === 'POST'){
      const b = await readBody(req);
      const port = parseInt(b.port, 10) || 8090;
      if(!(port >= 1024 && port <= 65535)) return sendJSON(res, { ok: false, error: '端口不合法' });
      try {
        const r = await localPost(port, '/v1/chat/completions', b.payload || {}, 600000);
        if(r.status !== 200) return sendJSON(res, { ok: false, error: '本地模型返回 HTTP ' + r.status + '：' + String(r.body || '').slice(0, 180) });
        return sendJSON(res, { ok: true, data: r.json });
      } catch(e){ return sendJSON(res, { ok: false, error: String((e && e.message) || e) }); }
    }
    // 是否已在服务端内置上报地址（只回布尔，不下发真实地址）
    if(url === '/api/wish-hook' && req.method === 'GET'){
      return sendJSON(res, {builtin: !!BUILTIN_WISH_HOOK, type: BUILTIN_WISH_TYPE});
    }
    // 技能抓取：把 GitHub 上的 SKILL.md 取回来交给前端解析入库
    if(url === '/api/skills/fetch' && req.method === 'POST'){
      const body = await readBody(req);
      const rawUrl = String(body.url || '').trim();
      if(!rawUrl) return sendJSON(res, {ok:false, error:'缺少链接'}, 400);
      const cands = ghCandidates(rawUrl);
      let lastErr = '';
      for(let i=0;i<cands.length;i++){
        try{
          const txt = await httpGetText(cands[i], i === 0 ? 8000 : 10000, 512 * 1024);
          if(!txt || !String(txt).trim()) throw new Error('取回来的内容是空的');
          return sendJSON(res, {ok:true, content: txt, via: cands[i]});
        }catch(e){ lastErr = String((e && e.message) || e); }
      }
      return sendJSON(res, {ok:false, error: lastErr || '抓取失败'});
    }
    // 许愿上报：服务端转发到企业微信 / 飞书群机器人（绕开浏览器跨域限制）
    if(url === '/api/wish-report' && req.method === 'POST'){
      const body = await readBody(req);
      const cfg = (state['ywx_settings'] || {});
      // 内置地址优先：客户本机设置无法覆盖
      const hook = BUILTIN_WISH_HOOK || String(cfg.wishWebhook || '').trim();
      if(!hook) return sendJSON(res, {ok:false, skipped:'未配置上报地址'});
      let type = String((BUILTIN_WISH_HOOK ? BUILTIN_WISH_TYPE : cfg.wishWebhookType) || 'auto');
      // 测试消息限频：同一台机器 1 分钟内只允许发一条测试
      if(body.__test){
        const t = Date.now();
        if(t - (global.__wishTestAt || 0) < 60000){
          return sendJSON(res, {ok:false, error:'测试太频繁了，请 1 分钟后再试'});
        }
        global.__wishTestAt = t;
      }
      if(type === 'auto'){ type = /open\.feishu\.cn|larksuite|feishu/i.test(hook) ? 'feishu' : 'wecom'; }
      const text = '【轻舟AI · 新的业务诉求】\n'
        + '诉求：' + (body.content || '') + '\n'
        + '联系人：' + (body.name || '匿名') + (body.contact ? '（' + body.contact + '）' : '') + '\n'
        + '时间：' + (body.createdAt || new Date().toLocaleString('zh-CN'));
      const payload = type === 'feishu'
        ? {msg_type:'text', content:{text:text}}
        : {msgtype:'text', text:{content:text}};
      try{
        const r = await postJSON(hook, payload, 6000);
        return sendJSON(res, {ok:true, status:r.status, resp:String(r.body||'').slice(0,400)});
      }catch(e){
        return sendJSON(res, {ok:false, error:String((e && e.message) || e)});
      }
    }
    // 静态托管前端
    if(url === '/' || url === '/index.html' || decodeURIComponent(url).includes('.html')){
      if(!fs.existsSync(HTML)) return sendJSON(res,{error:'未找到前端 HTML，请将 server.js 与 HTML 放于同目录'},404);
      const html = fs.readFileSync(HTML);
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(html);
    }
    // PWA 静态资源（manifest / service worker / 图标）
    const STATIC = {
      '/manifest.json': { file:'manifest.json', type:'application/manifest+json; charset=utf-8' },
      '/sw.js':         { file:'sw.js',         type:'application/javascript; charset=utf-8' },
      '/icon-192.png':  { file:'icon-192.png',  type:'image/png' },
      '/icon-512.png':  { file:'icon-512.png',  type:'image/png' }
    };
    if(STATIC[url]){
      const fp = path.join(DIR, STATIC[url].file);
      if(fs.existsSync(fp)){
        res.writeHead(200, {'Content-Type':STATIC[url].type, 'Cache-Control':'no-cache'});
        return res.end(fs.readFileSync(fp));
      }
    }
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('404 Not Found');
  }catch(e){
    sendJSON(res, {error:String(e)}, 500);
  }
});

/* 本地模型出题可能要几分钟，放宽服务端超时，否则请求会被中途掐断 */
server.requestTimeout = 660000;
server.headersTimeout = 660000;
server.timeout = 0;

loadStore();
server.on('error', (e)=>{
  if(e && e.code === 'EADDRINUSE'){
    console.error('端口 ' + PORT + ' 已被占用，请换个端口：PORT=3001 node server.js');
    process.exit(1);
  }
  console.error('服务启动失败:', e && e.message);
});
server.listen(PORT, '0.0.0.0', ()=>{
  const os = require('os');
  const ips = [];
  const nets = os.networkInterfaces();
  for(const k in nets){ nets[k].forEach(n=>{ if(n.family==='IPv4' && !n.internal) ips.push(n.address); }); }
  console.log('================================================');
  console.log('  轻舟AI · 培训考核系统 · 内网服务已启动');
  console.log('  本机访问:   http://localhost:'+PORT);
  ips.forEach(ip=>console.log('  同事访问:   http://'+ip+':'+PORT));
  console.log('  数据文件:   '+DATA);
  console.log('  许愿上报:   '+(BUILTIN_WISH_HOOK ? '已内置（自动推送到服务商）' : '未内置（可在设置页填写）'));
  const _sk = Array.isArray(state['ywx_skills']) ? state['ywx_skills'] : [];
  console.log('  技能库:     ' + _sk.filter(x=>x && x.enabled).length + ' 个启用 / 共 ' + _sk.length + ' 个');
  const _ls = state['ywx_settings'] || {};
  console.log('  AI 引擎:    ' + ({ online:'在线 API', local:'本地模型', rule:'仅规则（离线）' }[_ls.engine || 'online'] || '在线 API')
    + (_ls.engine === 'local' ? ('（127.0.0.1:' + (_ls.localPort || 8090) + '）') : ''));
  console.log('  提示: 首次启动已写入演示数据(admin/admin888)');
  console.log('================================================');
});
