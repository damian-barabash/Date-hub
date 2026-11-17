// Управление аккаунтами (без ролей): список, создание, смена пароля, удаление.
// Вход по логину: логин → служебный e-mail <login>@datehub.infinitiq.pl (письма не отправляются).
import { admin, cors, json, requireUser } from '../_shared/util.ts';

const DOMAIN = 'datehub.infinitiq.pl';
const loginToEmail = (u: string) => `${u.toLowerCase()}@${DOMAIN}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const me = await requireUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);
  const db = admin();
  const body = await req.json().catch(() => ({}));

  try {
    switch (body.action) {
      case 'list': {
        const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
        if (error) throw error;
        const { data: profiles } = await db.from('profiles').select('*');
        return json(data.users.map((u) => {
          const p = profiles?.find((x) => x.id === u.id);
          return { id: u.id, username: p?.username ?? u.email?.split('@')[0], display_name: p?.display_name ?? null, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, me: u.id === me.id };
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
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
