(() => {
  const field = id => document.getElementById(id);
  async function invoke(body) {
    const {data,error} = await window.sb.functions.invoke('bchess-push',{body});
    if (error) throw error;
    return data;
  }
  let pending;
  window.syncChessPush = () => {
    if (!window.sb?.auth || !('PushManager' in window) || Notification.permission !== 'granted') return;
    if (!pending) pending = register().catch(console.warn).finally(()=>{pending=null;});
    return pending;
  };
  async function register() {
    const {data:{session}} = await sb.auth.getSession();
    if (!session) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const {key} = await invoke({action:'key'});
      const bytes = Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    }
    await invoke({action:'register',subscription:sub.toJSON()});
  }
  window.sb?.auth?.onAuthStateChange((event) => {
    if(event === 'SIGNED_OUT' && 'serviceWorker' in navigator)
      navigator.serviceWorker.ready.then(r=>r.pushManager?.getSubscription()).then(s=>s?.unsubscribe()).catch(console.warn);
    else setTimeout(window.syncChessPush,0);
  });
  const draft=field('broadcastDraft'),send=field('broadcastSend'),status=field('broadcastStatus');
  let job;
  function edit(){draft.hidden=true;job=null;status.textContent='';}
  field('broadcastTitle').oninput=field('broadcastBody').oninput=edit;
  field('broadcastPreview').onclick=()=>{
    const title=field('broadcastTitle').value.trim(),body=field('broadcastBody').value.trim();
    if(!title||!body){status.textContent='Enter a title and message.';return;}
    field('draftTitle').textContent=title;field('draftBody').textContent=body;
    job ||= crypto.randomUUID();draft.hidden=false;send.disabled=false;
  };
  send.onclick=async()=>{
    if(send.disabled||!confirm('Send this notification to all subscribed players?'))return;
    send.disabled=true;
    const title=field('draftTitle').textContent,body=field('draftBody').textContent,id=job;
    for(const el of ['broadcastTitle','broadcastBody','broadcastPreview'])field(el).disabled=true;
    try{
      let cursor='',result;
      do {
        result=await invoke({action:'broadcast',id,title,body,cursor});
        cursor=result.next;
      } while(cursor);
      status.textContent=result.accepted+' accepted, '+result.failed+' failed, '+result.pending+' unconfirmed.';
      draft.hidden=true;
    }catch(e){status.textContent=e.message;send.disabled=false;}finally{for(const el of ['broadcastTitle','broadcastBody','broadcastPreview'])field(el).disabled=false;}
  };
})();
