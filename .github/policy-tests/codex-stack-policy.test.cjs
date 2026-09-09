'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {dependency,validate,run} = require('./codex-stack-policy.cjs');
function pr(number,base,dep,stack=null) {
  return {number,state:'open',body:`Change\n\nDepends on: ${dep === null?'none':'#'+dep}`,stack,
    head:{ref:`layer-${number}`,sha:`sha${number}`,repo:{full_name:'aletty/test'}},
    base:{ref:base,sha:'base',repo:{full_name:'aletty/test'}}};
}
function fixture() {
  const pulls=[pr(1,'main',null,{number:10}),pr(2,'layer-1',1,{number:10}),pr(3,'layer-2',2,{number:10})];
  return {repository:'aletty/test',defaultBranch:'main',pulls,
    stacks:[{number:10,open:true,base:{ref:'main'},pull_requests:structuredClone(pulls)}],ancestors:{'sha1:sha2':true,'sha2:sha3':true}};
}
test('standalone passes',()=>{const s=fixture();s.pulls=[pr(1,'main',null)];s.stacks=[];assert.equal(validate(s).get(1).ok,true);});
test('three-layer native stack passes',()=>assert.ok([...validate(fixture()).values()].every(r=>r.ok)));
test('missing, duplicate and malformed declarations fail',()=>{
  for(const body of ['', 'Depends on: none\nDepends on: #1','Depends on: #0','Depends on: #1 #2','<!-- Depends on: none -->']) assert.throws(()=>dependency(body));
  assert.equal(dependency('<!-- helper -->\nDepends on: #12'),12);
});
test('unregistered chain blocks child and parent',()=>{const s=fixture();s.stacks=[];for(const p of s.pulls)p.stack=null;assert.ok([...validate(s).values()].every(r=>!r.ok));});
test('incorrect parent fails entire native stack',()=>{const s=fixture();s.pulls[2].body='Depends on: #1';assert.ok([...validate(s).values()].every(r=>!r.ok));});
test('stale ancestry blocks entire native stack',()=>{const s=fixture();s.ancestors['sha1:sha2']=false;assert.ok([...validate(s).values()].every(r=>!r.ok));});
test('merged parent transition passes after retargeting',()=>{
  const s=fixture();s.pulls[0].state='closed';s.pulls[0].merged_at='now';s.stacks[0].pull_requests[0].state='closed';s.pulls[1].base.ref='main';
  assert.ok([...validate(s).values()].every(r=>r.ok));
});
test('closed unmerged parent fails',()=>{const s=fixture();s.pulls[0].state='closed';s.stacks[0].pull_requests[0].state='closed';s.pulls[1].base.ref='main';assert.equal(validate(s).get(2).ok,false);});
test('missing and self parents fail',()=>{const s=fixture();s.pulls[1].body='Depends on: #999';assert.equal(validate(s).get(2).ok,false);s.pulls[1].body='Depends on: #2';assert.equal(validate(s).get(2).ok,false);});
test('non-default trunk and cross-fork stack fail',()=>{const s=fixture();s.stacks[0].base.ref='release';assert.equal(validate(s).get(1).ok,false);s.stacks[0].base.ref='main';s.pulls[1].head.repo.full_name='someone/test';assert.equal(validate(s).get(2).ok,false);});
test('wrong base, missing native membership and duplicate stack membership fail',()=>{
  const s=fixture();s.pulls[1].base.ref='main';assert.equal(validate(s).get(2).ok,false);
  const t=fixture();t.pulls[0].stack=null;assert.equal(validate(t).get(1).ok,false);
  const u=fixture();u.stacks.push({...structuredClone(u.stacks[0]),number:11});assert.equal(validate(u).get(1).ok,false);
});
test('fork standalone allowed',()=>{const s=fixture();s.pulls=[pr(1,'main',null)];s.pulls[0].head.repo.full_name='fork/test';s.stacks=[];assert.equal(validate(s).get(1).ok,true);});
function harness({failure=false,change=false,shared=false}={}) {
  let reads=0;const updates=[],created=[],failures=[];
  const pulls=[pr(1,'main',null)];
  if(shared){const p=pr(2,'main',null);p.head.sha='sha1';p.body='';pulls.push(p);}
  const rest={pulls:{list:Symbol('list'),get:async()=>{throw new Error('not expected')}},
    issues:{listComments:Symbol('comments')},reactions:{listForIssue:Symbol('reactions')},
    repos:{get:async()=>({data:{default_branch:'main'}})},
    checks:{listForRef:Symbol('listChecks'),create:async p=>{created.push(p);return {data:{id:created.length}}},update:async p=>{updates.push(p);return {data:p}}}};
  const github={rest,paginate:async route=>{
    if(route===rest.pulls.list){reads++;const result=structuredClone(pulls);if(change&&reads>1)result[0].body+='\n'+reads;return result;}
    if(failure)throw new Error('GitHub unavailable');return [];
  }};
  const core={summary:{addHeading(){return this},addRaw(){return this},async write(){}},error(){},setFailed(x){failures.push(x)}};
  return {github,core,context:{repo:{owner:'aletty',repo:'test'},payload:{pull_request:pulls[0]},serverUrl:'https://github.com',runId:1},updates,created,failures};
}
test('controller issues pending then success on stable snapshot',async()=>{const h=harness();await run(h);assert.equal(h.created[0].status,'in_progress');assert.equal(h.updates.at(-1).conclusion,'success');assert.equal(h.failures.length,0);});
test('API failure revokes check and fails controller',async()=>{const h=harness({failure:true});await run(h);assert.equal(h.updates.at(-1).conclusion,'failure');assert.equal(h.failures.length,1);});
test('changing metadata never succeeds',async()=>{const h=harness({change:true});await run(h);assert.ok(h.updates.every(u=>u.conclusion==='failure'));assert.equal(h.failures.length,1);});
test('PRs sharing head SHA receive most restrictive result',async()=>{const h=harness({shared:true});await run(h);assert.equal(h.created.length,1);assert.equal(h.updates.at(-1).conclusion,'failure');});
const {codexReview} = require('./codex-stack-policy.cjs');
const bot={login:'chatgpt-codex-connector[bot]',type:'Bot'};
const at='2026-09-09T01:00:00Z', later='2026-09-09T02:00:00Z';
function summary(status='Completed', user=bot) {
 return {user,updated_at:at,body:`<!-- codex-pull-request-review-summary -->\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n| 📝 **Code Review** | ✅ **${status}** | \`abc1234\` | PR opened |\nCodex reacts with eyes while Running.`};
}
test('completed review passes regardless of findings or explanatory Running text',()=>assert.equal(codexReview([summary()],[]).ok,true));
test('running, failed, cancelled, queued and unknown summaries block',()=>{
 for(const status of ['Running','Failed','Cancelled','Queued','New Status']) assert.equal(codexReview([summary(status)],[]).ok,false);
 const c=summary(); c.body='<!-- codex-pull-request-review-summary -->\nunknown format';assert.equal(codexReview([c],[]).ok,false);
});
test('all concurrent review types must finish',()=>{
 const c=summary();c.body+='\n| 🔒 **Security Review** | 🔄 **Running** | `abc1234` | PR opened |';assert.equal(codexReview([c],[]).ok,false);
});
test('human cannot spoof completion or active bot status',()=>{
 assert.equal(codexReview([summary('Running',{login:'aletty',type:'User'})],[]).ok,true);
 assert.equal(codexReview([summary('Completed',{login:bot.login,type:'User'})],[{user:bot,content:'eyes',created_at:at}]).ok,false);
});
test('eyes-only review blocks and completion supersedes earlier eyes',()=>{
 const r={user:bot,content:'eyes',created_at:at};assert.equal(codexReview([],[r]).ok,false);
 assert.equal(codexReview([summary()],[r]).ok,false);
 const done=summary();done.updated_at=later;assert.equal(codexReview([done],[r]).ok,true);
 assert.equal(codexReview([summary()],[{...r,created_at:later}]).ok,false);
});
test('new manual review requests block even after previous completion',()=>{
 for(const body of ['@codex review']) {
  const r={body,created_at:later,authorizedRequest:true};assert.equal(codexReview([summary(),r],[]).ok,false);
  r.created_at='2026-09-09T00:59:59Z';assert.equal(codexReview([summary(),r],[]).ok,true);
 }
});
test('no requested or active review passes',()=>assert.equal(codexReview([],[]).ok,true));
test('active Codex review blocks entire native stack',()=>{
 const s=fixture();s.codex={2:codexReview([summary('Running')],[])};assert.ok([...validate(s).values()].every(r=>!r.ok));
});
test('review activity changing during publication cannot pass',async()=>{
 const h=harness();const paginate=h.github.paginate;let n=0;
 h.github.paginate=async(route,args)=>route===h.github.rest.issues.listComments ? [summary(++n%2?'Completed':'Running')] : paginate(route,args);
 await run(h);assert.ok(h.updates.every(u=>u.conclusion==='failure'));assert.equal(h.failures.length,1);
});

test('untrusted, quoted and fenced requests do not block',()=>{
 for (const r of [{body:'@codex review'}, {body:'> @codex review',authorizedRequest:true}, {body:'```\n@codex review\n```',authorizedRequest:true}, {body:'~~~\n@codex review\n~~~',authorizedRequest:true}])
  assert.equal(codexReview([summary(),{...r,created_at:later}],[]).ok,true);
});
test('publication recheck revokes success if a review begins while publishing',async()=>{
 const h=harness();const paginate=h.github.paginate;let published=false;
 const update=h.github.rest.checks.update;h.github.rest.checks.update=async p=>{if(p.conclusion==='success')published=true;return update(p);};
 h.github.paginate=async(route,args)=>route===h.github.rest.issues.listComments ? [summary(published?'Running':'Completed')] : paginate(route,args);
 await run(h);assert.equal(h.updates.at(-1).conclusion,'failure');assert.equal(h.failures.length,1);
});
test('review snapshot reads stay linear in number of heads',async()=>{
 const h=harness();const paginate=h.github.paginate;let reviewReads=0;
 h.github.paginate=async(route,args)=>{
  if(route===h.github.rest.pulls.list)return Array.from({length:20},(_,i)=>pr(i+1,'main',null));
  if(route===h.github.rest.issues.listComments)reviewReads++;
  return paginate(route,args);
 };
 await run(h);assert.equal(h.failures.length,0);assert.equal(reviewReads,80);
});
test('controller checks repository permission before accepting a manual request',async()=>{
 for(const permission of ['write','read']) {
  const h=harness();const paginate=h.github.paginate;
  h.github.rest.repos.getCollaboratorPermissionLevel=async()=>({data:{permission}});
  h.github.paginate=async(route,args)=>route===h.github.rest.issues.listComments ? [summary(),{body:'@codex review',created_at:later,user:{login:'visitor',type:'User'}}] : paginate(route,args);
  await run(h);assert.equal(h.failures.length,0);assert.equal(h.updates.at(-1).conclusion,permission==='write'?'failure':'success');
 }
});

test('timestamp ties and edited requests stay blocked',()=>{
 assert.equal(codexReview([summary(),{body:'@codex review',created_at:at,authorizedRequest:true}],[]).ok,false);
 assert.equal(codexReview([summary(),{body:'@codex review',created_at:'2026-09-08T00:00:00Z',updated_at:later,authorizedRequest:true}],[]).ok,false);
 assert.equal(codexReview([summary(),{body:'<!--\n@codex review\n-->',created_at:later,authorizedRequest:true}],[]).ok,true);
});
test('controller detects authenticated eyes on triggering comments',async()=>{
 const h=harness();const paginate=h.github.paginate;
 h.github.rest.reactions.listForIssueComment=Symbol('commentReactions');
 h.github.paginate=async(route,args)=>{
  if(route===h.github.rest.issues.listComments)return [{id:123,body:'legacy request',reactions:{eyes:1}}];
  if(route===h.github.rest.reactions.listForIssueComment)return [{user:bot,content:'eyes',created_at:at}];
  return paginate(route,args);
 };
 await run(h);assert.equal(h.failures.length,0);assert.equal(h.updates.at(-1).conclusion,'failure');
});
test('code completion cannot satisfy a security review request',()=>{
 const c=summary();c.updated_at=later;
 const request={body:'@codex security review',created_at:at,authorizedRequest:true};
 assert.equal(codexReview([c,request],[]).ok,false);
 c.body+='\n| 🔒 **Security Review** | ✅ **Completed** | `abc1234` | manual |';
 assert.equal(codexReview([c,request],[]).ok,true);
});
test('row completion time wins over a later unrelated summary edit',()=>{
 const c=summary();c.updated_at=later;c.body=c.body.replace('**Completed**','**Completed** <relative-time datetime="2026-09-09T00:59:59Z">old</relative-time>');
 assert.equal(codexReview([c,{body:'@codex review',created_at:at,authorizedRequest:true}],[]).ok,false);
});
test('deleting running summary preserves the wait until a later completion',()=>{
 const first=codexReview([summary('Running')],[]);
 assert.equal(codexReview([],[],first.memory).ok,false);
 const done=summary();done.updated_at=later;
 assert.equal(codexReview([done],[],first.memory).ok,true);
});
test('deleting an accepted request does not let an older completion pass',()=>{
 const first=codexReview([summary(),{body:'@codex review',created_at:later,authorizedRequest:true}],[]);
 assert.equal(codexReview([summary()],[],first.memory).ok,false);
});
test('controller persists and reloads active state from trusted check output',async()=>{
 const h=harness();const paginate=h.github.paginate;
 h.github.paginate=async(route,args)=>route===h.github.rest.issues.listComments ? [summary('Running')] : paginate(route,args);
 await run(h);
 const saved=h.updates.at(-1);
 const next=harness();const nextPaginate=next.github.paginate;
 next.github.paginate=async(route,args)=>route===next.github.rest.checks.listForRef ? [{app:{slug:'github-actions'},output:saved.output}] : nextPaginate(route,args);
 await run(next);assert.equal(next.failures.length,0);assert.equal(next.updates.at(-1).conclusion,'failure');
});
test('synchronize carries recorded active state from the preceding head',async()=>{
 const h=harness();h.context.payload.before='oldsha';const paginate=h.github.paginate;
 h.github.paginate=async(route,args)=>route===h.github.rest.checks.listForRef && args.ref==='oldsha' ? [{app:{slug:'github-actions'},output:{text:'codex-review-memory-v2:'+JSON.stringify({1:{seen:true,after:{code:Date.parse(at)}}})}}] : paginate(route,args);
 await run(h);assert.equal(h.failures.length,0);assert.equal(h.updates.at(-1).conclusion,'failure');
});
