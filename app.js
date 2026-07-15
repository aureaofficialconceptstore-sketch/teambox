const config = window.TEAMBOX_CONFIG || {};
const configured = /^https:\/\//.test(config.supabaseUrl || '') && !String(config.supabaseUrl).includes('YOUR_PROJECT') && String(config.supabaseAnonKey || '').length > 20;
const authScreen = document.querySelector('#auth-screen');
const authForm = document.querySelector('#auth-form');
const authTitle = document.querySelector('#auth-title');
const authCopy = document.querySelector('#auth-copy');
const authError = document.querySelector('#auth-error');
const authName = document.querySelector('#auth-name');
const authEmail = document.querySelector('#auth-email');
const authEmailField = document.querySelector('#auth-email-field');
const authPassword = document.querySelector('#auth-password');
const authSubmit = document.querySelector('#auth-submit');
const authSwitch = document.querySelector('#auth-switch');
const messagesEl = document.querySelector('#messages');
const channelsEl = document.querySelector('#channels');
const input = document.querySelector('#message-input');
const title = document.querySelector('#channel-title');
const desc = document.querySelector('#channel-description');
const dialog = document.querySelector('#channel-dialog');
const fmt = new Intl.DateTimeFormat('it-IT', { weekday:'long', day:'numeric', month:'long' });
document.querySelector('#today').textContent = fmt.format(new Date());
let client, current, user, isSignup = false, inviteMode = false, activeRealtime;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const toSlug = value => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const initials = name => name.split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase();
const messageTime = value => new Intl.DateTimeFormat('it-IT', { hour:'2-digit', minute:'2-digit' }).format(new Date(value));
function avatarColor(id){return ['coral','blue','gold','violet'][[...id].reduce((sum,char)=>sum+char.charCodeAt(0),0)%4];}
function showAuthError(message=''){authError.textContent=message;}
function showApp(){authScreen.classList.add('hidden');}
function showAuth(){authScreen.classList.remove('hidden');}
function setAuthMode(signup){
  if(signup && !config.allowSelfSignup) return;
  inviteMode=false; isSignup=signup; authEmailField.hidden=false; authName.closest('label').classList.toggle('auth-name-field', !signup);
  authTitle.textContent=signup ? 'Crea il tuo account' : 'Accedi al tuo team';
  authCopy.textContent=signup ? 'Ti invieremo un’email per confermare l’account.' : 'Usa l’indirizzo email e la password del tuo account.';
  authSubmit.textContent=signup ? 'Crea account' : 'Accedi';
  authSwitch.textContent=signup ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati';
  authPassword.autocomplete=signup ? 'new-password' : 'current-password'; showAuthError('');
}
function setInviteMode(){
  inviteMode=true; isSignup=false; authEmailField.hidden=true; authName.closest('label').classList.remove('auth-name-field');
  authTitle.textContent='Completa il tuo invito'; authCopy.textContent='Scegli un nome e una password per entrare in TeamBox.';
  authSubmit.textContent='Entra in TeamBox'; authSwitch.hidden=true; authPassword.autocomplete='new-password'; showAuthError('');
}
function setIdentity(profile){
  const name = profile?.display_name || user.user_metadata?.display_name || user.email.split('@')[0];
  document.querySelector('.profile .avatar').textContent=initials(name);
  document.querySelector('.profile strong').textContent=name;
}
async function ensureProfile(){
  const name = user.user_metadata?.display_name || user.email.split('@')[0];
  const { data, error } = await client.from('profiles').upsert({ id:user.id, display_name:name, avatar_color:avatarColor(user.id) }).select().single();
  if(error) throw error; setIdentity(data); return data;
}
async function renderChannels(){
  const { data, error } = await client.from('channels').select('id, slug, description').order('created_at');
  if(error) throw error;
  if(!data.length){current=null; channelsEl.innerHTML='<p class="empty-channels">Crea il primo canale del team.</p>'; return;}
  if(!current || !data.some(channel=>channel.id===current.id)) current=data[0];
  channelsEl.innerHTML=data.map((channel,index)=>`<button class="channel ${channel.id===current.id?'active':''}" data-channel="${channel.id}"><span class="hash">#</span> ${escapeHtml(channel.slug)}${index===0?'<span class="pin">⌖</span>':''}</button>`).join('');
}
async function renderMessages(){
  if(!current){messagesEl.innerHTML='<div class="empty-messages">Crea un canale per iniziare a conversare.</div>';return;}
  const { data, error } = await client.from('messages').select('id, body, created_at, author:profiles(display_name, avatar_color)').eq('channel_id', current.id).order('created_at');
  if(error) throw error;
  title.textContent=current.slug; desc.textContent=current.description; input.placeholder=`Scrivi in #${current.slug}`;
  messagesEl.innerHTML=`<div class="date-divider">Oggi</div>${data.map(message=>{const author=message.author||{display_name:'Membro del team',avatar_color:'violet'};return `<article class="message"><span class="avatar ${escapeHtml(author.avatar_color||'violet')}">${escapeHtml(initials(author.display_name))}</span><div class="message-content"><div class="message-meta"><strong>${escapeHtml(author.display_name)}</strong><time>${messageTime(message.created_at)}</time></div><p>${escapeHtml(message.body)}</p></div></article>`;}).join('')}`;
  messagesEl.scrollTop=messagesEl.scrollHeight;
}
async function chooseChannel(id){
  const { data, error } = await client.from('channels').select('id, slug, description').eq('id', id).single(); if(error) throw error;
  current=data; await renderChannels(); await renderMessages(); subscribeToMessages();
}
function subscribeToMessages(){
  if(activeRealtime) client.removeChannel(activeRealtime);
  if(!current) return;
  activeRealtime=client.channel(`messages-${current.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`channel_id=eq.${current.id}`},()=>renderMessages().catch(showError)).subscribe();
}
function showError(error){console.error(error); alert(error.message || 'Non è stato possibile completare l’operazione. Riprova.');}
async function start(sessionUser){
  user=sessionUser; await ensureProfile(); await renderChannels(); await renderMessages(); subscribeToMessages(); showApp();
}
async function boot(){
  if(!configured){authTitle.textContent='Connessione in preparazione';authCopy.textContent='Stiamo collegando TeamBox al suo spazio sicuro.';authForm.style.display='none';return;}
  client=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
  authSwitch.hidden=!config.allowSelfSignup;
  const isInviteLink=new URLSearchParams(window.location.hash.slice(1)).get('type')==='invite';
  const { data:{user:sessionUser} }=await client.auth.getUser();
  if(sessionUser && isInviteLink){user=sessionUser;setInviteMode();showAuth();} else if(sessionUser) await start(sessionUser); else showAuth();
  client.auth.onAuthStateChange((_event, session)=>{if(!session) showAuth();});
}
authSwitch.addEventListener('click',()=>setAuthMode(!isSignup));
authForm.addEventListener('submit',async event=>{event.preventDefault();if(!configured)return;showAuthError('');authSubmit.disabled=true;authSubmit.textContent='Attendi…';try{
  if(inviteMode){const name=authName.value.trim();if(!name) throw new Error('Inserisci il tuo nome.');const {data,error}=await client.auth.updateUser({password:authPassword.value,data:{display_name:name}});if(error)throw error;window.history.replaceState({},document.title,window.location.pathname);await start(data.user);
  }else if(isSignup){const name=authName.value.trim();if(!name) throw new Error('Inserisci il tuo nome.');const { data, error }=await client.auth.signUp({email:authEmail.value,password:authPassword.value,options:{data:{display_name:name}}});if(error) throw error;if(data.user && !data.session){setAuthMode(false);showAuthError('Controlla la tua email e conferma l’account, poi accedi.');}else if(data.user) await start(data.user);
  }else{const { data, error }=await client.auth.signInWithPassword({email:authEmail.value,password:authPassword.value});if(error) throw error;await start(data.user);}
}catch(error){showAuthError(error.message||'Non è stato possibile accedere.');}finally{authSubmit.disabled=false;authSubmit.textContent=inviteMode?'Entra in TeamBox':isSignup?'Crea account':'Accedi';}});
channelsEl.addEventListener('click',event=>{const button=event.target.closest('[data-channel]');if(button) chooseChannel(Number(button.dataset.channel)).catch(showError);});
document.querySelector('#composer').addEventListener('submit',async event=>{event.preventDefault();const body=input.value.trim();if(!body||!current)return;try{const { error }=await client.from('messages').insert({channel_id:current.id,author_id:user.id,body});if(error)throw error;input.value='';await renderMessages();}catch(error){showError(error);}});
document.querySelector('#add-channel').addEventListener('click',()=>dialog.showModal());
document.querySelector('#create-channel').addEventListener('click',async event=>{event.preventDefault();const slug=toSlug(document.querySelector('#channel-name').value);if(!slug)return;try{const {data,error}=await client.from('channels').insert({slug,description:document.querySelector('#channel-desc').value.trim()||'Un nuovo spazio per il team',created_by:user.id}).select('id, slug, description').single();if(error)throw error;current=data;dialog.close();await renderChannels();await renderMessages();subscribeToMessages();}catch(error){showError(error);}});
document.querySelector('#new-message').addEventListener('click',()=>input.focus());
document.querySelector('#emoji').addEventListener('click',()=>{input.value+=' 😊';input.focus();});
document.querySelector('#attach').addEventListener('click',()=>alert('Gli allegati saranno il prossimo collegamento: richiedono uno spazio di archiviazione condiviso.'));
document.querySelector('#welcome-action').addEventListener('click',()=>alert('Benvenuta! Crea canali per gli argomenti del team e usa i messaggi diretti per le conversazioni private.'));
document.querySelector('#activity').innerHTML=[['A','coral','Anna ha aggiunto un messaggio in #generale','10 min fa'],['L','blue','Luca ha condiviso un file in #design','35 min fa'],['S','gold','Sofia ha creato un nuovo canale','1 ora fa']].map(a=>`<div class="activity-item"><span class="avatar small ${a[1]}">${a[0]}</span><p><strong>${a[2]}</strong><time>${a[3]}</time></p></div>`).join('');
boot().catch(showError);
