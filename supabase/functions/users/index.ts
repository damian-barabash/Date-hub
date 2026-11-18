// Управление аккаунтами и воркспейсами — только администратор (profiles.is_admin).
// Аккаунты: список, создание, смена пароля, удаление. Воркспейсы: список, создание, переименование, удаление, доступ (дать/забрать), права админа.
// Вход по логину: логин → служебный e-mail <login>@datehub.infinitiq.pl (письма не отправляются).
import { admin, cors, isAdmin, json, requireUser } from '../_shared/util.ts';

const DOMAIN = 'datehub.infinitiq.pl';
const loginToEmail = (u: string) => `${u.toLowerCase()}@${DOMAIN}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const me = await requireUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);
  const db = admin();
  const body = await req.json().catch(() => ({}));
  const amAdmin = await isAdmin(me);
  // обычный пользователь видит только свои воркспейсы (для переключателя)
  if (body.action === 'my_workspaces') {
    const { data: ws } = amAdmin ? await db.from('workspaces').select('id, name, created_at').order('created_at')
      : await db.from('workspaces').select('id, name, created_at, workspace_members!inner(user_id)').eq('workspace_members.user_id', me.id).order('created_at');
    return json({ admin: amAdmin, workspaces: (ws ?? []).map((w: any) => ({ id: w.id, name: w.name })) });
  }
  if (!amAdmin) return json({ error: 'Tylko administrator może zarządzać kontami i workspace’ami' }, 403);

  try {
    switch (body.action) {
      case 'list': {
        const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
        if (error) throw error;
        const { data: profiles } = await db.from('profiles').select('*');
        return json(data.users.map((u) => {
          const p = profiles?.find((x) => x.id === u.id);
          return { id: u.id, username: p?.username ?? u.email?.split('@')[0], display_name: p?.display_name ?? null, is_admin: !!p?.is_admin, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, me: u.id === me.id };
        }));
      }
      case 'create': {
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return json({ error: 'Login: 3–32 znaki (litery, cyfry, . _ -)' }, 400);
        if (password.length < 8) return json({ error: 'Hasło: minimum 8 znaków' }, 400);
        const { data, error } = await db.auth.admin.createUser({
          email: loginToEmail(username), password, email_confirm: true, user_metadata: { username },
        });
        if (error) throw error;
        await db.from('profiles').insert({ id: data.user.id, username: username.toLowerCase(), display_name: body.display_name || username });
        const wsIds = (Array.isArray(body.workspaces) ? body.workspaces : []).map(String);
        if (wsIds.length) await db.from('workspace_members').insert(wsIds.map((w: string) => ({ workspace_id: w, user_id: data.user.id })));
        return json({ id: data.user.id });
      }
      case 'password': {
        const password = String(body.password ?? '');
        if (password.length < 8) return json({ error: 'Hasło: minimum 8 znaków' }, 400);
        const { error } = await db.auth.admin.updateUserById(String(body.id), { password });
        if (error) throw error;
        return json({ ok: true });
      }
      case 'delete': {
        if (body.id === me.id) return json({ error: 'Nie można usunąć własnego konta' }, 400);
        const { error } = await db.auth.admin.deleteUser(String(body.id));
        if (error) throw error;
        return json({ ok: true });
      }
      // ── воркспейсы
      case 'ws_list': {
        const [{ data: ws }, { data: mem }] = await Promise.all([
          db.from('workspaces').select('id, name, created_at').order('created_at'),
          db.from('workspace_members').select('workspace_id, user_id'),
        ]);
        return json((ws ?? []).map((w) => ({ ...w, members: (mem ?? []).filter((m) => m.workspace_id === w.id).map((m) => m.user_id) })));
      }
      case 'ws_create': {
        const name = String(body.name ?? '').trim().slice(0, 60);
        if (!name) return json({ error: 'Podaj nazwę' }, 400);
        const { data, error } = await db.from('workspaces').insert({ name, created_by: me.id }).select('id').single();
        if (error) throw error;
        await db.from('workspace_members').insert({ workspace_id: data.id, user_id: me.id });
        return json({ id: data.id });
      }
      case 'ws_rename': {
        const name = String(body.name ?? '').trim().slice(0, 60);
        if (!name) return json({ error: 'Podaj nazwę' }, 400);
        const { error } = await db.from('workspaces').update({ name }).eq('id', String(body.id));
        if (error) throw error;
        return json({ ok: true });
      }
      case 'ws_delete': {
        const { count } = await db.from('workspaces').select('id', { count: 'exact', head: true });
        if ((count ?? 0) <= 1) return json({ error: 'Nie można usunąć ostatniego workspace' }, 400);
        const { error } = await db.rpc('ws_delete', { p_id: String(body.id) });
        if (error) throw error;
        return json({ ok: true });
      }
      case 'ws_access': { // дать (grant=true) или забрать доступ
        const row = { workspace_id: String(body.workspace_id), user_id: String(body.user_id) };
        const { error } = body.grant
          ? await db.from('workspace_members').upsert(row, { onConflict: 'workspace_id,user_id' })
          : await db.from('workspace_members').delete().eq('workspace_id', row.workspace_id).eq('user_id', row.user_id);
        if (error) throw error;
        return json({ ok: true });
      }
      case 'set_admin': {
        if (body.id === me.id && !body.value) return json({ error: 'Nie można odebrać uprawnień administratora samemu sobie' }, 400);
        const { error } = await db.from('profiles').update({ is_admin: !!body.value }).eq('id', String(body.id));
        if (error) throw error;
        return json({ ok: true });
      }
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
