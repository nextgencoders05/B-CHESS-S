const {fixture}=require('./interactions.cjs'),assert=require('assert');
(async()=>{
 const t=await fixture(390),{w,clock}=t;let inbox={},callback,actions=[];
 w.__ref={on:(event,cb)=>{callback=cb;},off(){},once:async()=>({val:()=>inbox})};
 w.eval("database.ref=()=>window.__ref;currentUserId='bob'");t.authCallbacks.at(-1)({uid:'bob'});await clock.tickAsync(0);
 function incoming(id){inbox[id]={id:'request-'+id,fromName:id,fromPhoto:'https://example.invalid/avatar.png',createdAt:1};callback({val:()=>inbox});}
 incoming('Alice');assert(w.document.getElementById('friendRequestToast').textContent.includes('Alice'));assert.equal(w.document.querySelector('#friendRequestToast [role=timer]').textContent,'10s');
 callback({val:()=>inbox});assert.equal(w.document.querySelectorAll('#friendRequestToast').length,1);
 await clock.tickAsync(10001);assert(!w.document.getElementById('friendRequestToast'));assert(w.document.querySelector('[data-friend-notice="Alice"]'));assert(inbox.Alice);
 callback({val:()=>inbox});assert(!w.document.getElementById('friendRequestToast'));
 w.sbCall=async(name,args)=>{actions.push(args);delete inbox[args.p_other];return {status:'friends'}};
 w.document.querySelector('[data-friend-notice="Alice"] button').click();await clock.tickAsync(0);assert.equal(actions[0].p_action,'accept');assert(!w.document.querySelector('[data-friend-notice="Alice"]'));
 incoming('Carol');w.document.querySelectorAll('#friendRequestToast button')[1].click();await clock.tickAsync(0);assert.equal(actions[1].p_action,'decline');assert(!inbox.Carol);
 incoming('Dan');const req=inbox.Dan;await w.BChessFriends.respond('Dan','accept',req);await clock.tickAsync(0);assert(!w.document.getElementById('friendRequestToast'));
 // Reconnecting the account with seen pending requests must not replay the popup.
 incoming('Offline');await clock.tickAsync(10001);t.authCallbacks.at(-1)(null);t.authCallbacks.at(-1)({uid:'bob'});await clock.tickAsync(0);assert(w.document.querySelector('[data-friend-notice="Offline"]'));assert(!w.document.getElementById('friendRequestToast'));
 assert.deepEqual(t.errors,[]);t.close();console.log('PASS friend popup delivery (mock subscription), countdown, duplicate suppression, persistent bell, accept, decline and account reconnect.');
})().catch(e=>{console.error(e);process.exit(1)});
