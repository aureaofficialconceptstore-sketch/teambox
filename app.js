const config = window.TEAMBOX_CONFIG || {};
const configured = /^https:\/\//.test(config.supabaseUrl || '') && !String(config.supabaseUrl).includes('YOUR_PROJECT') && String(config.supabaseAnonKey || '').length > 20;
const $ = selector => document.querySelector(selector);
const authScreen = $('#auth-screen');
const authForm = $('#auth-form');
const authTitle = $('#auth-title');
const authCopy = $('#auth-copy');
const authError = $('#auth-error');
const authName = $('#auth-name');
const authEmail = $('#auth-email');
const authEmailField = $('#auth-email-field');
const authPassword = $('#auth-password');
const authSubmit = $('#auth-submit');
const authSwitch = $('#auth-switch');
const messagesEl = $('#messages');
const channelsEl = $('#channels');
const directsEl = $('#direct-messages');
const input = $('#message-input');
const title = $('#channel-title');
const prefix = $('#channel-prefix');
const desc = $('#channel-description');
const channelDialog = $('#channel-dialog');
const directDialog = $('#direct-dialog');
const membersDialog = $('#members-dialog');
const searchDialog = $('#search-dialog');
const canvasDialog = $('#canvas-dialog');
const calendarDialog = $('#calendar-dialog');
const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
$('#today').textContent = fmt.format(new Date());

let client, user, current = null, activeRealtime, isSignup = false, inviteMode = false;
let teamProfiles = [];
let directThreads = new Map();
let channelList = [];
let channelFilter = '';
let canvasDoc = { notes: '', tables: [] };
let calendarCursor = new Date();
let calendarEvents = [];
let calendarLocalOnly = false;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const toSlug = value => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const messageTime = value => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const relativeTime = value => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(value));
};
const avatarColor = id => ['coral', 'blue', 'gold', 'violet'][[...String(id)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4];
const byteSize = value => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const isMissingFeature = error => /direct_thread|message_attachment|channel_members|direct_canvases|calendar_events|create_team_channel|add_channel_members|teambox-files|relation .* does not exist|schema cache/i.test(error?.message || '');
const authRedirectUrl = () => `${window.location.origin}${window.location.pathname}`;

function showAuthError(message = '') { authError.textContent = message; }
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
}
function showApp() { authScreen.classList.add('hidden'); }
function showAuth() { authScreen.classList.remove('hidden'); }
function showError(error) {
  console.error(error);
  showToast(isMissingFeature(error)
    ? 'This feature needs the workspace database update. Run supabase_features.sql once, then refresh.'
    : error?.message || 'That could not be completed. Please try again.');
}
function setAuthMode(signup) {
  if (signup && !config.allowSelfSignup) return;
  inviteMode = false;
  isSignup = signup;
  authEmailField.hidden = false;
  authName.closest('label').classList.toggle('auth-name-field', !signup);
  authTitle.textContent = signup ? 'Create your account' : 'Sign in to your team';
  authCopy.textContent = signup ? 'We will send an email to confirm your account.' : 'Use your account email and password.';
  authSubmit.textContent = signup ? 'Create account' : 'Sign in';
  authSwitch.textContent = signup ? 'Already have an account? Sign in' : 'Need an account? Sign up';
  authPassword.autocomplete = signup ? 'new-password' : 'current-password';
  showAuthError('');
}
function setInviteMode() {
  inviteMode = true;
  isSignup = false;
  authEmailField.hidden = true;
  authName.closest('label').classList.remove('auth-name-field');
  authTitle.textContent = 'Complete your invitation';
  authCopy.textContent = 'Choose a name and password to join AUREA Team.';
  authSubmit.textContent = 'Join AUREA Team';
  authSwitch.hidden = true;
  authPassword.autocomplete = 'new-password';
  showAuthError('');
}
function setIdentity(profile) {
  const name = profile?.display_name || user.user_metadata?.display_name || user.email.split('@')[0];
  $('.profile .avatar').textContent = initials(name);
  $('.profile .avatar').className = `avatar ${profile?.avatar_color || avatarColor(user.id)}`;
  $('.profile strong').textContent = name;
}
async function ensureProfile() {
  const name = user.user_metadata?.display_name || user.email.split('@')[0];
  const { data, error } = await client.from('profiles').upsert({ id: user.id, display_name: name, avatar_color: avatarColor(user.id) }).select().single();
  if (error) throw error;
  setIdentity(data);
  return data;
}

function memberMarkup(profile, selectable = false) {
  const name = escapeHtml(profile.display_name);
  const detail = profile.id === user?.id ? 'You' : 'Team member';
  const isAction = selectable && profile.id !== user?.id;
  const action = isAction ? ` data-profile="${profile.id}"` : '';
  const tag = isAction ? 'button' : 'div';
  const type = isAction ? ' type="button"' : '';
  return `<${tag}${type} class="member-row"${action}><span class="avatar ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span><span><strong>${name}</strong><small>${detail}</small></span>${isAction ? '<span class="member-row-action">Message</span>' : ''}</${tag}>`;
}
function renderUniversalSearch() {
  const results = $('#global-search-results');
  const term = channelFilter.trim();
  if (!term) { results.innerHTML = ''; return; }
  const people = teamProfiles.filter(profile => profile.id !== user?.id && profile.display_name.toLowerCase().includes(term)).slice(0, 4);
  const channels = channelList.filter(channel => `${channel.slug} ${channel.description}`.toLowerCase().includes(term)).slice(0, 5);
  const chats = [...directThreads.entries()].filter(([, profile]) => profile.display_name.toLowerCase().includes(term)).slice(0, 4);
  const personResults = people.length ? `<p class="search-group-label">PEOPLE</p>${people.map(profile => `<button type="button" class="global-search-result" data-global-user="${profile.id}"><span class="avatar small ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span><span>${escapeHtml(profile.display_name)}</span></button>`).join('')}` : '';
  const channelResults = channels.length ? `<p class="search-group-label">CHANNELS & GROUPS</p>${channels.map(channel => `<button type="button" class="global-search-result" data-global-channel="${channel.id}"><span>#</span><span>${escapeHtml(channel.slug)}</span></button>`).join('')}` : '';
  const chatResults = chats.length ? `<p class="search-group-label">PRIVATE CHATS</p>${chats.map(([threadId, profile]) => `<button type="button" class="global-search-result" data-global-direct="${threadId}"><span>↗</span><span>${escapeHtml(profile.display_name)}</span></button>`).join('')}` : '';
  results.innerHTML = personResults || channelResults || chatResults ? `${personResults}${channelResults}${chatResults}` : '<p class="global-search-empty">No people, channels or groups found.</p>';
}
async function renderTeam() {
  const { data, error } = await client.from('profiles').select('id, display_name, avatar_color, created_at').order('display_name');
  if (error) throw error;
  teamProfiles = data || [];
  $('#team-list').innerHTML = teamProfiles.length ? teamProfiles.slice(0, 5).map(profile => memberMarkup(profile)).join('') : '<p class="empty-list">No other members yet.</p>';
  $('#members-list').innerHTML = teamProfiles.length ? teamProfiles.map(profile => memberMarkup(profile)).join('') : '<p class="empty-list">No members found.</p>';
  $('#member-picker').innerHTML = teamProfiles.filter(profile => profile.id !== user.id).length
    ? teamProfiles.map(profile => memberMarkup(profile, true)).join('')
    : '<p class="empty-list">Invite another person to the workspace before starting a private conversation.</p>';
  $('#channel-member-picker').innerHTML = teamProfiles.filter(profile => profile.id !== user.id).length
    ? teamProfiles.filter(profile => profile.id !== user.id).map(profile => `<label class="channel-member-option"><span class="avatar small ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span><span>${escapeHtml(profile.display_name)}</span><input type="checkbox" data-channel-profile="${profile.id}" /></label>`).join('')
    : '<p class="empty-list">People will appear here after they join the workspace.</p>';
  renderUniversalSearch();
}
async function renderChannels() {
  const { data, error } = await client.from('channels').select('id, slug, description, created_by, created_at').order('created_at');
  if (error) throw error;
  channelList = data || [];
  if (!channelList.length) {
    if (!current || current.kind === 'channel') current = null;
    channelsEl.innerHTML = '<p class="empty-channels">Create the first team channel.</p>';
    return;
  }
  if (!current) current = { kind: 'channel', ...channelList[0] };
  if (current.kind === 'channel' && !channelList.some(channel => channel.id === current.id)) current = { kind: 'channel', ...channelList[0] };
  const visible = channelList.filter(channel => `${channel.slug} ${channel.description}`.toLowerCase().includes(channelFilter));
  channelsEl.innerHTML = visible.length
    ? visible.map(channel => `<button class="channel ${current?.kind === 'channel' && channel.id === current.id ? 'active' : ''}" data-channel="${channel.id}"><span class="hash">#</span> ${escapeHtml(channel.slug)}</button>`).join('')
    : '<p class="empty-channels">No channels or groups found.</p>';
  renderCalendarChannels();
  renderUniversalSearch();
}
async function renderDirectThreads() {
  try {
    const own = await client.from('direct_thread_members').select('thread_id').eq('profile_id', user.id);
    if (own.error) throw own.error;
    const ids = own.data.map(row => row.thread_id);
    if (!ids.length) {
      directThreads = new Map();
      directsEl.innerHTML = '<p class="empty-channels">No private conversations yet.</p>';
      renderUniversalSearch();
      return;
    }
    const others = await client.from('direct_thread_members').select('thread_id, profile:profiles(id, display_name, avatar_color)').in('thread_id', ids).neq('profile_id', user.id);
    if (others.error) throw others.error;
    directThreads = new Map((others.data || []).filter(row => row.profile).map(row => [row.thread_id, row.profile]));
    directsEl.innerHTML = directThreads.size
      ? [...directThreads.entries()].map(([threadId, profile]) => `<button class="dm ${current?.kind === 'direct' && current.id === threadId ? 'active' : ''}" data-direct="${threadId}"><span class="avatar small ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span> ${escapeHtml(profile.display_name)}</button>`).join('')
      : '<p class="empty-channels">No private conversations yet.</p>';
    renderUniversalSearch();
  } catch (error) {
    directsEl.innerHTML = '<p class="empty-channels">Direct messages will be available after the workspace update.</p>';
    renderUniversalSearch();
    if (!isMissingFeature(error)) console.error(error);
  }
}
async function currentMembers() {
  if (!current) return [];
  if (current.kind === 'direct') return [teamProfiles.find(profile => profile.id === user.id), current.partner].filter(Boolean);
  const { data, error } = await client.from('channel_members').select('profile:profiles(id, display_name, avatar_color)').eq('channel_id', current.id);
  if (error) {
    if (isMissingFeature(error)) return teamProfiles;
    throw error;
  }
  return (data || []).map(row => row.profile).filter(Boolean);
}
async function renderCurrentMembers(showDialog = false) {
  const members = await currentMembers();
  $('#show-members').innerHTML = members.slice(0, 4).map(profile => `<span class="avatar tiny ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span>`).join('') || '<span class="member-count">0</span>';
  if (!showDialog) return;
  const isChannel = current?.kind === 'channel';
  $('#members-eyebrow').textContent = isChannel ? 'CHANNEL MEMBERS' : 'PRIVATE CHAT';
  $('#members-title').textContent = isChannel ? `People in #${current.slug}` : `Chat with ${current.partner.display_name}`;
  $('#members-list').innerHTML = members.length ? members.map(profile => memberMarkup(profile)).join('') : '<p class="empty-list">No members in this channel.</p>';
  if (isChannel && current.created_by === user.id) {
    const notMembers = teamProfiles.filter(profile => !members.some(member => member.id === profile.id));
    $('#members-actions').innerHTML = notMembers.length ? `<p class="dialog-label">Add people</p><div class="selectable-members">${notMembers.map(profile => `<label class="channel-member-option"><span class="avatar small ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span><span>${escapeHtml(profile.display_name)}</span><input type="checkbox" data-add-member="${profile.id}" /></label>`).join('')}</div><button class="create" type="button" id="add-channel-members">Add to channel</button>` : '';
  } else {
    $('#members-actions').innerHTML = '';
  }
  if (!membersDialog.open) membersDialog.showModal();
}
async function refreshCurrentMembers() {
  try { await renderCurrentMembers(); }
  catch (error) {
    if (!isMissingFeature(error)) throw error;
    $('#show-members').innerHTML = teamProfiles.slice(0, 4).map(profile => `<span class="avatar tiny ${escapeHtml(profile.avatar_color || 'violet')}">${escapeHtml(initials(profile.display_name))}</span>`).join('');
  }
}
function attachmentMarkup(file) {
  return `<button class="attachment" data-file-path="${encodeURIComponent(file.file_path)}"><span>↗</span><span><strong>${escapeHtml(file.file_name)}</strong><small>${byteSize(Number(file.byte_size || 0))}</small></span></button>`;
}
function messageMarkup(message) {
  const author = message.author || { display_name: 'Team member', avatar_color: 'violet' };
  const files = message.message_attachments || message.attachments || [];
  return `<article class="message"><span class="avatar ${escapeHtml(author.avatar_color || 'violet')}">${escapeHtml(initials(author.display_name))}</span><div class="message-content"><div class="message-meta"><strong>${escapeHtml(author.display_name)}</strong><time>${messageTime(message.created_at)}</time></div><p>${escapeHtml(message.body)}</p>${files.length ? `<div class="attachments">${files.map(attachmentMarkup).join('')}</div>` : ''}</div></article>`;
}
function setHeader() {
  if (!current) {
    prefix.textContent = '#';
    title.textContent = 'no-channel';
    desc.textContent = 'Create a channel to get started.';
    input.placeholder = 'Create a channel to start writing';
    $('#start-call').disabled = true;
    $('#start-call').title = 'Choose a conversation before starting a video call';
    $('#open-canvas').disabled = true;
    $('#open-canvas').title = 'Open a private chat to use the shared canvas';
    return;
  }
  const isChannel = current.kind === 'channel';
  prefix.textContent = isChannel ? '#' : '';
  title.textContent = isChannel ? current.slug : current.partner.display_name;
  desc.textContent = isChannel ? (current.description || 'Team channel') : 'Direct message';
  input.placeholder = isChannel ? `Write in #${current.slug}` : `Write to ${current.partner.display_name}`;
  $('#start-call').disabled = false;
  $('#start-call').title = isChannel ? 'Start a channel video call' : 'Start a private video call';
  $('#open-canvas').disabled = isChannel;
  $('#open-canvas').title = isChannel ? 'Canvas is available in private chats' : 'Open shared canvas';
}
async function channelMessages() {
  const withAttachments = await client.from('messages').select('id, body, created_at, author:profiles(display_name, avatar_color), message_attachments(id, file_name, file_path, mime_type, byte_size)').eq('channel_id', current.id).order('created_at');
  if (!withAttachments.error) return withAttachments;
  if (!isMissingFeature(withAttachments.error)) return withAttachments;
  return client.from('messages').select('id, body, created_at, author:profiles(display_name, avatar_color)').eq('channel_id', current.id).order('created_at');
}
async function renderMessages() {
  setHeader();
  if (!current) {
    messagesEl.innerHTML = '<div class="empty-messages">Create a channel to start a conversation.</div>';
    return;
  }
  const result = current.kind === 'channel'
    ? await channelMessages()
    : await client.from('direct_messages').select('id, body, created_at, author:profiles(display_name, avatar_color)').eq('thread_id', current.id).order('created_at');
  if (result.error) throw result.error;
  const data = result.data || [];
  messagesEl.innerHTML = data.length
    ? `<div class="date-divider">${fmt.format(new Date(data[0].created_at))}</div>${data.map(messageMarkup).join('')}`
    : '<div class="empty-messages">No messages yet. Start the conversation.</div>';
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
async function renderActivity() {
  const { data, error } = await client.from('messages').select('body, created_at, author:profiles(display_name, avatar_color), channel:channels(slug)').order('created_at', { ascending: false }).limit(5);
  if (error) throw error;
  $('#activity').innerHTML = data?.length
    ? data.map(message => `<div class="activity-item"><span class="avatar small ${escapeHtml(message.author?.avatar_color || 'violet')}">${escapeHtml(initials(message.author?.display_name))}</span><p><strong>${escapeHtml(message.author?.display_name || 'A team member')} posted in #${escapeHtml(message.channel?.slug || 'channel')}</strong><span class="activity-text">${escapeHtml(message.body)}</span><time>${relativeTime(message.created_at)}</time></p></div>`).join('')
    : '<p class="empty-list">New activity will appear here.</p>';
}
async function chooseChannel(id) {
  const { data, error } = await client.from('channels').select('id, slug, description, created_by, created_at').eq('id', id).single();
  if (error) throw error;
  current = { kind: 'channel', ...data };
  await renderChannels();
  await renderDirectThreads();
  await renderMessages();
  await refreshCurrentMembers();
  subscribeToMessages();
}
async function chooseDirect(id, partner = directThreads.get(id)) {
  if (!partner) throw new Error('This conversation is unavailable.');
  current = { kind: 'direct', id: Number(id), partner };
  await renderChannels();
  await renderDirectThreads();
  await renderMessages();
  await refreshCurrentMembers();
  subscribeToMessages();
}
function subscribeToMessages() {
  if (activeRealtime) client.removeChannel(activeRealtime);
  if (!current) return;
  const table = current.kind === 'channel' ? 'messages' : 'direct_messages';
  const field = current.kind === 'channel' ? 'channel_id' : 'thread_id';
  activeRealtime = client.channel(`${table}-${current.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `${field}=eq.${current.id}` }, () => {
      renderMessages().then(renderActivity).catch(showError);
    }).subscribe();
}
async function start(sessionUser) {
  user = sessionUser;
  await ensureProfile();
  await renderTeam();
  await renderChannels();
  await renderDirectThreads();
  await renderMessages();
  await refreshCurrentMembers();
  await renderActivity();
  subscribeToMessages();
  showApp();
}
async function sendMessage() {
  const body = input.value.trim();
  if (!body) { showToast('Write a message before sending it.'); return; }
  if (!current) { showToast('Select or create a channel before sending.'); return; }
  const sendButton = $('#composer .send');
  sendButton.disabled = true;
  const payload = current.kind === 'channel'
    ? { channel_id: current.id, author_id: user.id, body }
    : { thread_id: current.id, author_id: user.id, body };
  const table = current.kind === 'channel' ? 'messages' : 'direct_messages';
  try {
    const { error } = await client.from(table).insert(payload);
    if (error) throw error;
    input.value = '';
    await renderMessages();
    await renderActivity();
  } finally {
    sendButton.disabled = false;
  }
}
async function uploadFile(file) {
  if (!current || current.kind !== 'channel') throw new Error('Share files inside a team channel.');
  if (file.size > 25 * 1024 * 1024) throw new Error('This file exceeds the 25 MB workspace limit.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'file';
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const upload = await client.storage.from('teambox-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (upload.error) throw upload.error;
  const inserted = await client.from('messages').insert({ channel_id: current.id, author_id: user.id, body: `📎 ${file.name}` }).select('id').single();
  if (inserted.error) {
    await client.storage.from('teambox-files').remove([path]);
    throw inserted.error;
  }
  const attachment = await client.from('message_attachments').insert({ message_id: inserted.data.id, file_name: file.name, file_path: path, mime_type: file.type || null, byte_size: file.size, created_by: user.id });
  if (attachment.error) throw attachment.error;
  await renderMessages();
  await renderActivity();
}
async function openAttachment(path) {
  const attachmentWindow = window.open('', '_blank');
  if (!attachmentWindow) throw new Error('Your browser blocked the file window. Allow pop-ups for TeamBox and try again.');
  attachmentWindow.opener = null;
  const { data, error } = await client.storage.from('teambox-files').createSignedUrl(path, 60);
  if (error) { attachmentWindow.close(); throw error; }
  attachmentWindow.location.href = data.signedUrl;
}
async function openDirect(profileId) {
  const profile = teamProfiles.find(member => member.id === profileId);
  if (!profile) throw new Error('Team member not found.');
  const { data, error } = await client.rpc('get_or_create_direct_thread', { other_profile_id: profileId });
  if (error) throw error;
  directDialog.close();
  await renderDirectThreads();
  await chooseDirect(data, profile);
}
async function runSearch() {
  const term = $('#search-input').value.trim();
  if (!term) return;
  const { data, error } = await client.from('messages').select('id, body, created_at, channel:channels(id, slug)').ilike('body', `%${term}%`).order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  $('#search-results').innerHTML = data?.length
    ? data.map(message => `<button type="button" class="search-result" data-search-channel="${message.channel.id}"><strong>#${escapeHtml(message.channel.slug)}</strong><span>${escapeHtml(message.body)}</span><small>${relativeTime(message.created_at)}</small></button>`).join('')
    : '<p class="empty-list">No messages found.</p>';
}
function startCall() {
  if (!current) { showToast('Choose a channel or private chat before starting a video call.'); return; }
  const project = new URL(config.supabaseUrl).hostname.split('.')[0].replace(/[^a-z0-9]/gi, '');
  const room = `AureaTeam-${project}-${current.kind}-${current.id}`;
  const callWindow = window.open(`https://meet.jit.si/${encodeURIComponent(room)}`, '_blank', 'noopener');
  if (!callWindow) showToast('Your browser blocked the call window. Allow pop-ups for TeamBox and try again.');
}
function makeCanvasTable() {
  return { id: crypto.randomUUID(), cells: [['Header 1', 'Header 2', 'Header 3'], ['', '', ''], ['', '', '']] };
}
function normaliseCanvas(content) {
  const tables = Array.isArray(content?.tables) ? content.tables.map(table => ({
    id: table.id || crypto.randomUUID(),
    cells: Array.isArray(table.cells) && table.cells.length ? table.cells.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '')) : ['']) : [['Header 1', 'Header 2', 'Header 3'], ['', '', ''], ['', '', '']]
  })) : [];
  return { notes: String(content?.notes || ''), tables };
}
function renderCanvasTables() {
  const target = $('#canvas-tables');
  target.innerHTML = canvasDoc.tables.length ? canvasDoc.tables.map((table, tableIndex) => {
    const width = Math.max(1, ...table.cells.map(row => row.length));
    const rows = table.cells.map((row, rowIndex) => `<tr>${Array.from({ length: width }, (_, colIndex) => `<td><input value="${escapeHtml(row[colIndex] || '')}" data-canvas-table="${tableIndex}" data-canvas-row="${rowIndex}" data-canvas-col="${colIndex}" /></td>`).join('')}</tr>`).join('');
    return `<section class="canvas-table-wrap"><div class="canvas-table-actions"><strong>Table ${tableIndex + 1}</strong><span><button type="button" data-canvas-add-row="${tableIndex}">＋ Row</button><button type="button" data-canvas-delete-table="${tableIndex}">Remove</button></span></div><table class="canvas-table"><tbody>${rows}</tbody></table></section>`;
  }).join('') : '<p class="empty-list">Add a table to organise ideas, tasks or decisions.</p>';
}
async function openCanvas() {
  if (!current || current.kind !== 'direct') { showToast('Canvas is available in 1:1 private chats.'); return; }
  const { data, error } = await client.from('direct_canvases').select('title, content').eq('thread_id', current.id).maybeSingle();
  if (error) throw error;
  canvasDoc = normaliseCanvas(data?.content);
  $('#canvas-title').value = data?.title || `Notes with ${current.partner.display_name}`;
  $('#canvas-notes').value = canvasDoc.notes;
  renderCanvasTables();
  canvasDialog.showModal();
}
async function saveCanvas() {
  if (!current || current.kind !== 'direct') return;
  canvasDoc.notes = $('#canvas-notes').value;
  const titleValue = $('#canvas-title').value.trim() || `Notes with ${current.partner.display_name}`;
  const saveButton = $('#save-canvas');
  saveButton.disabled = true;
  try {
    const { error } = await client.from('direct_canvases').upsert({ thread_id: current.id, title: titleValue, content: canvasDoc, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
    showToast('Canvas saved for both people.');
  } finally {
    saveButton.disabled = false;
  }
}
function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function calendarBounds() {
  const start = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const end = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  return { start, end };
}
function localCalendarEvents() {
  try { return JSON.parse(localStorage.getItem('aurea-calendar-events') || '[]'); }
  catch { return []; }
}
function saveLocalCalendarEvents(events) { localStorage.setItem('aurea-calendar-events', JSON.stringify(events)); }
function renderCalendarChannels() {
  const select = $('#event-channel');
  const selected = select.value;
  select.innerHTML = '<option value="">AUREA team calendar</option>' + channelList.map(channel => `<option value="${channel.id}">#${escapeHtml(channel.slug)}</option>`).join('');
  select.value = selected;
}
function eventDate(event) { return new Date(event.starts_at); }
function renderCalendar() {
  const { start } = calendarBounds();
  $('#calendar-month').textContent = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(start);
  const firstWeekday = (start.getDay() + 6) % 7;
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const today = dateInputValue(new Date());
  const cells = [];
  for (let blank = 0; blank < firstWeekday; blank += 1) cells.push('<div class="calendar-day blank"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), day);
    const isoDate = dateInputValue(date);
    const events = calendarEvents.filter(event => dateInputValue(eventDate(event)) === isoDate);
    cells.push(`<button type="button" class="calendar-day ${isoDate === today ? 'today' : ''}" data-calendar-date="${isoDate}"><time>${day}</time><span class="calendar-day-events">${events.slice(0, 2).map(event => `<i class="${event.kind === 'call' ? 'call' : ''}">${escapeHtml(event.title)}</i>`).join('')}</span></button>`);
  }
  $('#calendar-grid').innerHTML = cells.join('');
  const upcoming = calendarEvents.filter(event => eventDate(event).getTime() >= Date.now() - 60000).sort((a, b) => eventDate(a) - eventDate(b)).slice(0, 5);
  $('#calendar-upcoming').innerHTML = `<p class="eyebrow">UPCOMING${calendarLocalOnly ? ' · THIS DEVICE ONLY' : ''}</p>${upcoming.length ? upcoming.map(event => `<article class="calendar-event"><time>${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(eventDate(event))}</time><div><strong>${escapeHtml(event.title)}</strong><span>${event.channel?.slug ? `#${escapeHtml(event.channel.slug)}` : 'AUREA team'}${event.kind === 'call' ? ' · Video call' : ''}</span></div>${event.kind === 'call' ? `<button type="button" data-join-event="${event.id}">Join</button>` : ''}${event.created_by === user?.id ? `<button type="button" class="calendar-delete" data-delete-event="${event.id}" aria-label="Delete event">×</button>` : ''}</article>`).join('') : '<p class="empty-list">No upcoming events this month.</p>'}`;
}
async function fetchCalendarEvents() {
  const { start, end } = calendarBounds();
  const result = await client.from('calendar_events').select('id, title, starts_at, ends_at, kind, channel_id, video_room, created_by, channel:channels(slug)').gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at');
  if (result.error) {
    if (!isMissingFeature(result.error)) throw result.error;
    calendarLocalOnly = true;
    calendarEvents = localCalendarEvents().filter(event => {
      const date = eventDate(event);
      return date >= start && date < end;
    });
  } else {
    calendarLocalOnly = false;
    calendarEvents = result.data || [];
  }
  renderCalendar();
}
async function openCalendar() {
  calendarCursor = new Date();
  $('#event-date').value = dateInputValue(new Date());
  $('#event-time').value = '10:00';
  $('#event-title').value = '';
  $('#event-is-call').checked = false;
  renderCalendarChannels();
  await fetchCalendarEvents();
  calendarDialog.showModal();
}
async function saveCalendarEvent() {
  const titleValue = $('#event-title').value.trim();
  const date = $('#event-date').value;
  const time = $('#event-time').value || '10:00';
  if (!titleValue || !date) { showToast('Add a title and date for the event.'); return; }
  const startsAt = new Date(`${date}T${time}:00`);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const isCall = $('#event-is-call').checked;
  const project = new URL(config.supabaseUrl).hostname.split('.')[0].replace(/[^a-z0-9]/gi, '');
  const payload = { title: titleValue, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), kind: isCall ? 'call' : 'event', channel_id: $('#event-channel').value ? Number($('#event-channel').value) : null, video_room: isCall ? `AureaTeam-${project}-event-${crypto.randomUUID()}` : null, created_by: user.id };
  const result = await client.from('calendar_events').insert(payload).select().single();
  if (result.error) {
    if (!isMissingFeature(result.error)) throw result.error;
    calendarLocalOnly = true;
    const localEvent = { ...payload, id: `local-${crypto.randomUUID()}`, channel: payload.channel_id ? channelList.find(channel => channel.id === payload.channel_id) : null };
    saveLocalCalendarEvents([...localCalendarEvents(), localEvent]);
    showToast('Time blocked on this device. Run the workspace update to share it with the team.');
  } else {
    calendarLocalOnly = false;
    showToast(isCall ? 'Video call scheduled and time blocked.' : 'Time blocked in the calendar.');
  }
  await fetchCalendarEvents();
  $('#event-title').value = '';
}
async function deleteCalendarEvent(id) {
  if (String(id).startsWith('local-')) {
    saveLocalCalendarEvents(localCalendarEvents().filter(event => event.id !== id));
  } else {
    const { error } = await client.from('calendar_events').delete().eq('id', id);
    if (error) throw error;
  }
  await fetchCalendarEvents();
}
function joinCalendarEvent(id) {
  const event = calendarEvents.find(item => String(item.id) === String(id));
  if (!event?.video_room) return;
  window.open(`https://meet.jit.si/${encodeURIComponent(event.video_room)}`, '_blank', 'noopener');
}
async function boot() {
  if (!configured) {
    authTitle.textContent = 'Connection in progress';
    authCopy.textContent = 'AUREA Team is connecting to its secure workspace.';
    authForm.style.display = 'none';
    return;
  }
  client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  authSwitch.hidden = !config.allowSelfSignup;
  const isInviteLink = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'invite';
  const { data: { user: sessionUser } } = await client.auth.getUser();
  if (sessionUser && isInviteLink) {
    user = sessionUser;
    setInviteMode();
    showAuth();
  } else if (sessionUser) {
    await start(sessionUser);
  } else {
    showAuth();
  }
  client.auth.onAuthStateChange((_event, session) => { if (!session) showAuth(); });
}

authSwitch.addEventListener('click', () => setAuthMode(!isSignup));
authForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!configured) return;
  showAuthError('');
  authSubmit.disabled = true;
  authSubmit.textContent = 'Attendi…';
  try {
    if (inviteMode) {
      const name = authName.value.trim();
      if (!name) throw new Error('Enter your name.');
      const { data, error } = await client.auth.updateUser({ password: authPassword.value, data: { display_name: name } });
      if (error) throw error;
      window.history.replaceState({}, document.title, window.location.pathname);
      await start(data.user);
    } else if (isSignup) {
      const name = authName.value.trim();
      if (!name) throw new Error('Enter your name.');
      const { data, error } = await client.auth.signUp({
        email: authEmail.value,
        password: authPassword.value,
        options: { data: { display_name: name }, emailRedirectTo: authRedirectUrl() }
      });
      if (error) throw error;
      if (data.user && !data.session) {
        setAuthMode(false);
        showAuthError('Check your email, confirm your account, then sign in.');
      } else if (data.user) {
        await start(data.user);
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email: authEmail.value, password: authPassword.value });
      if (error) throw error;
      await start(data.user);
    }
  } catch (error) {
    showAuthError(error.message || 'Sign-in could not be completed.');
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = inviteMode ? 'Join AUREA Team' : isSignup ? 'Create account' : 'Sign in';
  }
});
channelsEl.addEventListener('click', event => {
  const button = event.target.closest('[data-channel]');
  if (button) chooseChannel(Number(button.dataset.channel)).catch(showError);
});
$('#channel-search').addEventListener('input', event => {
  channelFilter = event.target.value.trim().toLowerCase();
  renderChannels().catch(showError);
  renderUniversalSearch();
});
$('#global-search-results').addEventListener('click', event => {
  const userButton = event.target.closest('[data-global-user]');
  const channelButton = event.target.closest('[data-global-channel]');
  const directButton = event.target.closest('[data-global-direct]');
  if (userButton) openDirect(userButton.dataset.globalUser).catch(showError);
  if (channelButton) chooseChannel(Number(channelButton.dataset.globalChannel)).catch(showError);
  if (directButton) chooseDirect(Number(directButton.dataset.globalDirect)).catch(showError);
  if (userButton || channelButton || directButton) {
    $('#channel-search').value = '';
    channelFilter = '';
    renderChannels().catch(showError);
    renderUniversalSearch();
  }
});
directsEl.addEventListener('click', event => {
  const button = event.target.closest('[data-direct]');
  if (button) chooseDirect(Number(button.dataset.direct)).catch(showError);
});
$('#composer').addEventListener('submit', event => { event.preventDefault(); sendMessage().catch(showError); });
$('#add-channel').addEventListener('click', () => channelDialog.showModal());
$('#welcome-action').addEventListener('click', () => channelDialog.showModal());
$('#create-channel').addEventListener('click', async event => {
  event.preventDefault();
  const slug = toSlug($('#channel-name').value);
  if (!slug) return;
  try {
    const invitedProfileIds = [...document.querySelectorAll('[data-channel-profile]:checked')].map(input => input.dataset.channelProfile);
    const description = $('#channel-desc').value.trim() || 'A new space for the team';
    let result = await client.rpc('create_team_channel', { channel_slug: slug, channel_description: description, invited_profile_ids: invitedProfileIds });
    let channel = Array.isArray(result.data) ? result.data[0] : result.data;
    if (result.error && isMissingFeature(result.error)) {
      result = await client.from('channels').insert({ slug, description, created_by: user.id }).select('id, slug, description, created_by, created_at').single();
      channel = result.data;
      if (!result.error && invitedProfileIds.length) showToast('Channel created. Run the workspace update before choosing its members.');
    }
    if (result.error) throw result.error;
    if (!channel) throw new Error('The channel was not created.');
    current = { kind: 'channel', ...channel, created_by: user.id };
    $('#channel-name').value = '';
    $('#channel-desc').value = '';
    document.querySelectorAll('[data-channel-profile]').forEach(input => { input.checked = false; });
    channelDialog.close();
    await renderChannels();
    await renderMessages();
    await renderCurrentMembers();
    await renderActivity();
    subscribeToMessages();
  } catch (error) { showError(error); }
});
async function openDirectPicker() {
  await renderTeam();
  directDialog.showModal();
}
$('#new-message').addEventListener('click', () => openDirectPicker().catch(showError));
$('#open-calendar').addEventListener('click', () => openCalendar().catch(showError));
$('#calendar-previous').addEventListener('click', async () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); await fetchCalendarEvents().catch(showError); });
$('#calendar-next').addEventListener('click', async () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); await fetchCalendarEvents().catch(showError); });
$('#calendar-grid').addEventListener('click', event => {
  const day = event.target.closest('[data-calendar-date]');
  if (!day) return;
  $('#event-date').value = day.dataset.calendarDate;
  $('#event-title').focus();
});
$('#save-event').addEventListener('click', () => saveCalendarEvent().catch(showError));
$('#calendar-upcoming').addEventListener('click', event => {
  const join = event.target.closest('[data-join-event]');
  const remove = event.target.closest('[data-delete-event]');
  if (join) joinCalendarEvent(join.dataset.joinEvent);
  if (remove) deleteCalendarEvent(remove.dataset.deleteEvent).catch(showError);
});
$('#sign-out').addEventListener('click', async () => {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    current = null;
    showAuth();
    setAuthMode(false);
  } catch (error) { showError(error); }
});
$('#emoji').addEventListener('click', () => { input.value += ' 😊'; input.focus(); });
$('#attach').addEventListener('click', () => $('#file-picker').click());
$('#file-picker').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) uploadFile(file).catch(showError);
});
messagesEl.addEventListener('click', event => {
  const button = event.target.closest('[data-file-path]');
  if (button) openAttachment(decodeURIComponent(button.dataset.filePath)).catch(showError);
});
$('#add-direct').addEventListener('click', () => openDirectPicker().catch(showError));
$('#member-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-profile]');
  if (button) openDirect(button.dataset.profile).catch(showError);
});
$('#show-members').addEventListener('click', () => renderCurrentMembers(true).catch(showError));
$('#show-team').addEventListener('click', async () => { try { await renderTeam(); membersDialog.showModal(); } catch (error) { showError(error); } });
$('#members-actions').addEventListener('click', async event => {
  if (!event.target.closest('#add-channel-members')) return;
  const profileIds = [...document.querySelectorAll('[data-add-member]:checked')].map(input => input.dataset.addMember);
  if (!profileIds.length) { showToast('Choose at least one person.'); return; }
  try {
    const { error } = await client.rpc('add_channel_members', { target_channel_id: current.id, invited_profile_ids: profileIds });
    if (error) throw error;
    await renderCurrentMembers(true);
    showToast('People added to the channel.');
  } catch (error) { showError(error); }
});
$('#start-call').addEventListener('click', startCall);
$('#open-canvas').addEventListener('click', () => openCanvas().catch(showError));
$('#add-table').addEventListener('click', () => { canvasDoc.tables.push(makeCanvasTable()); renderCanvasTables(); });
$('#canvas-tables').addEventListener('input', event => {
  const input = event.target.closest('[data-canvas-table]');
  if (!input) return;
  const table = canvasDoc.tables[Number(input.dataset.canvasTable)];
  if (table?.cells?.[Number(input.dataset.canvasRow)]) table.cells[Number(input.dataset.canvasRow)][Number(input.dataset.canvasCol)] = input.value;
});
$('#canvas-tables').addEventListener('click', event => {
  const addRow = event.target.closest('[data-canvas-add-row]');
  const remove = event.target.closest('[data-canvas-delete-table]');
  if (addRow) {
    const table = canvasDoc.tables[Number(addRow.dataset.canvasAddRow)];
    table.cells.push(Array(Math.max(1, ...table.cells.map(row => row.length))).fill(''));
    renderCanvasTables();
  }
  if (remove) { canvasDoc.tables.splice(Number(remove.dataset.canvasDeleteTable), 1); renderCanvasTables(); }
});
$('#save-canvas').addEventListener('click', () => saveCanvas().catch(showError));
$('#search-button').addEventListener('click', () => { $('#search-input').value = ''; $('#search-results').innerHTML = ''; searchDialog.showModal(); setTimeout(() => $('#search-input').focus(), 0); });
$('#run-search').addEventListener('click', () => runSearch().catch(showError));
$('#search-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runSearch().catch(showError); } });
$('#search-results').addEventListener('click', event => {
  const button = event.target.closest('[data-search-channel]');
  if (button) { searchDialog.close(); chooseChannel(Number(button.dataset.searchChannel)).catch(showError); }
});

boot().catch(showError);
