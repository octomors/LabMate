import fs from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import initSqlJs, { type Database as SqlDatabase, type SqlJsStatic } from 'sql.js'

type Role = 'student' | 'tutor'
type AuthRequest = Request & { user?: { id: number; email: string; role: Role } }

const app = express()
const databasePath = path.join(process.cwd(), 'labmate.sqlite')
let db: SqliteStore
const secret = process.env.JWT_SECRET ?? 'labmate-development-secret'

class SqliteStore {
  constructor(private readonly database: SqlDatabase) {}

  exec(sql: string) {
    this.database.run(sql)
    this.save()
  }

  pragma(sql: string) {
    this.database.run(`PRAGMA ${sql}`)
  }

  prepare(sql: string) {
    return {
      all: (...params: unknown[]) => {
        const statement = this.database.prepare(sql)
        statement.bind(params)
        const rows: Record<string, unknown>[] = []
        while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>)
        statement.free()
        return rows
      },
      get: (...params: unknown[]) => {
        const statement = this.database.prepare(sql)
        statement.bind(params)
        const row = statement.step() ? statement.getAsObject() : undefined
        statement.free()
        return row
      },
      run: (...params: unknown[]) => {
        this.database.run(sql, params)
        const result = this.database.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid')[0]?.values[0] ?? [0, 0]
        this.save()
        return { changes: Number(result[0]), lastInsertRowid: Number(result[1]) }
      },
    }
  }

  private save() {
    fs.writeFileSync(databasePath, Buffer.from(this.database.export()))
  }
}

async function initializeDatabase() {
  const sqlite = await initSqlJs({ locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file) })
  const database = new sqlite.Database(fs.existsSync(databasePath) ? new Uint8Array(fs.readFileSync(databasePath)) : undefined)
  db = new SqliteStore(database)
  db.pragma('foreign_keys = ON')
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', subject_id INTEGER REFERENCES subjects(id), topic_id INTEGER NOT NULL REFERENCES topics(id), assignment TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, selected_tutor_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(task_id, tutor_id));
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, sender_id INTEGER NOT NULL REFERENCES users(id), tutor_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`)
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
  if (!taskColumns.some((column) => column.name === 'subject_id')) db.exec('ALTER TABLE tasks ADD COLUMN subject_id INTEGER REFERENCES subjects(id)')
  if (!taskColumns.some((column) => column.name === 'assignment')) db.exec("ALTER TABLE tasks ADD COLUMN assignment TEXT NOT NULL DEFAULT ''")
  if (!taskColumns.some((column) => column.name === 'comment')) db.exec("ALTER TABLE tasks ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
  db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES ('Без предмета')").run()
  db.prepare("UPDATE tasks SET subject_id = (SELECT id FROM subjects WHERE name = 'Без предмета') WHERE subject_id IS NULL").run()
}

app.use(express.json())

function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Требуется вход' })
  try {
    req.user = jwt.verify(token, secret) as AuthRequest['user']
    if (!req.user?.id || !db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id)) {
      return res.status(401).json({ error: 'Пользователь не найден, войдите снова' })
    }
    next()
  } catch {
    res.status(401).json({ error: 'Сессия истекла' })
  }
}

function topicId(name: string) {
  const normalized = name.trim()
  const existing = db.prepare('SELECT id FROM topics WHERE name = ?').get(normalized) as { id: number } | undefined
  if (existing) return existing.id
  return Number(db.prepare('INSERT INTO topics (name) VALUES (?) RETURNING id').get(normalized).id)
}

function catalogId(table: 'subjects' | 'topics', name: string) {
  const normalized = name.trim()
  const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(normalized) as { id: number } | undefined
  if (existing) return existing.id
  return Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?) RETURNING id`).get(normalized).id)
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Введите email и пароль от 6 символов' })
  try {
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email.toLowerCase(), await bcrypt.hash(password, 10))
    const user = { id: Number(result.lastInsertRowid), email: email.toLowerCase(), role: 'student' as Role }
    res.json({ token: jwt.sign(user, secret), user })
  } catch {
    res.status(409).json({ error: 'Пользователь с таким email уже существует' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?').get(email?.toLowerCase()) as { id: number; email: string; password_hash: string; role: Role } | undefined
  if (!user || !password || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Неверный email или пароль' })
  const safeUser = { id: user.id, email: user.email, role: user.role }
  res.json({ token: jwt.sign(safeUser, secret), user: safeUser })
})

app.get('/api/me', auth, (req: AuthRequest, res) => res.json(req.user))

app.get('/api/topics', auth, (_req, res) => res.json(db.prepare('SELECT name FROM topics ORDER BY name').all().map((row) => (row as { name: string }).name)))
app.get('/api/catalog', auth, (_req, res) => res.json({
  subjects: db.prepare('SELECT name FROM subjects ORDER BY name').all().map((row) => (row as { name: string }).name),
  topics: db.prepare('SELECT name FROM topics ORDER BY name').all().map((row) => (row as { name: string }).name),
}))

app.get('/api/tasks', auth, (req: AuthRequest, res) => {
  const isTutor = req.query.view === 'tutor'
  const topic = typeof req.query.topic === 'string' ? req.query.topic : ''
  const minPrice = Number(req.query.minPrice ?? 0)
  const rows = db.prepare(`
    SELECT t.id, t.title, s.name AS subject, tp.name AS topic, t.assignment, t.comment, t.price, t.selected_tutor_id AS selectedTutorId,
      u.email AS studentEmail, COUNT(a.id) AS applications,
      (SELECT body FROM messages m WHERE m.task_id = t.id ORDER BY m.id LIMIT 1) AS firstMessage
    FROM tasks t JOIN topics tp ON tp.id=t.topic_id JOIN subjects s ON s.id=t.subject_id JOIN users u ON u.id=t.student_id
    LEFT JOIN applications a ON a.task_id=t.id
    WHERE (? = 0 OR t.student_id = ?) AND (? = 1 OR t.selected_tutor_id IS NULL) AND (? = '' OR tp.name = ?) AND (? = 0 OR t.price >= ?)
    GROUP BY t.id ORDER BY t.created_at DESC
  `).all(isTutor ? 0 : 1, req.user?.id, isTutor ? 1 : 0, topic, topic, minPrice, minPrice)
  res.json(rows)
})

app.post('/api/tasks', auth, (req: AuthRequest, res) => {
  const { title, subject, topic, assignment, comment, price } = req.body as { title?: string; subject?: string; topic?: string; assignment?: string; comment?: string; price?: number }
  if (!title || !subject || !topic || !assignment || !price) return res.status(400).json({ error: 'Заполните название, предмет, тему, задание и цену' })
  const result = db.prepare('INSERT INTO tasks (student_id, title, description, subject_id, topic_id, assignment, comment, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.user?.id, title, assignment, catalogId('subjects', subject), topicId(topic), assignment, comment?.trim() ?? '', price)
  res.status(201).json({ id: Number(result.lastInsertRowid) })
})

app.delete('/api/tasks/:id', auth, (req: AuthRequest, res) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ? AND student_id = ?').run(req.params.id, req.user?.id)
  if (!result.changes) return res.status(404).json({ error: 'Задача не найдена' })
  res.status(204).end()
})

app.post('/api/tasks/:id/apply', auth, (req: AuthRequest, res) => {
  const { message } = req.body as { message?: string }
  const task = db.prepare('SELECT student_id FROM tasks WHERE id = ? AND selected_tutor_id IS NULL').get(req.params.id) as { student_id: number } | undefined
  if (!task || !message) return res.status(400).json({ error: 'Отклик недоступен' })
  try {
    const application = db.prepare('INSERT INTO applications (task_id, tutor_id) VALUES (?, ?)').run(req.params.id, req.user?.id)
    db.prepare('INSERT INTO messages (task_id, sender_id, tutor_id, body) VALUES (?, ?, ?, ?)').run(req.params.id, req.user?.id, req.user?.id, message)
    res.status(201).json({ id: Number(application.lastInsertRowid) })
  } catch {
    res.status(409).json({ error: 'Вы уже откликнулись на эту задачу' })
  }
})

app.get('/api/tasks/:id/chats', auth, (req: AuthRequest, res) => {
  const task = db.prepare('SELECT student_id, selected_tutor_id FROM tasks WHERE id = ?').get(req.params.id) as { student_id: number; selected_tutor_id: number | null } | undefined
  if (!task || (task.student_id !== req.user?.id && task.selected_tutor_id !== req.user?.id)) return res.status(403).json({ error: 'Нет доступа' })
  const chats = db.prepare(`
    SELECT m.tutor_id AS tutorId, u.email AS tutorEmail,
      json_group_array(json_object('id', m.id, 'body', m.body, 'senderId', m.sender_id, 'createdAt', m.created_at)) AS messages
    FROM messages m JOIN users u ON u.id=m.tutor_id WHERE m.task_id=? GROUP BY m.tutor_id
  `).all(req.params.id)
  res.json(chats.map((chat) => ({ ...chat as object, messages: JSON.parse((chat as { messages: string }).messages) })))
})

app.post('/api/tasks/:id/select', auth, (req: AuthRequest, res) => {
  const task = db.prepare('SELECT student_id FROM tasks WHERE id=?').get(req.params.id) as { student_id: number } | undefined
  if (!task || task.student_id !== req.user?.id) return res.status(403).json({ error: 'Только студент может выбрать репетитора' })
  db.prepare('UPDATE tasks SET selected_tutor_id=? WHERE id=? AND selected_tutor_id IS NULL').run(req.body.tutorId, req.params.id)
  res.status(204).end()
})

app.post('/api/tasks/:id/messages', auth, (req: AuthRequest, res) => {
  const { tutorId, body } = req.body as { tutorId?: number; body?: string }
  const task = db.prepare('SELECT student_id, selected_tutor_id FROM tasks WHERE id=?').get(req.params.id) as { student_id: number; selected_tutor_id: number | null } | undefined
  if (!task || !body || !tutorId || (task.student_id !== req.user?.id && task.selected_tutor_id !== req.user?.id) || (task.selected_tutor_id && task.selected_tutor_id !== tutorId)) return res.status(403).json({ error: 'Сообщение нельзя отправить' })
  db.prepare('INSERT INTO messages (task_id, sender_id, tutor_id, body) VALUES (?, ?, ?, ?)').run(req.params.id, req.user?.id, tutorId, body)
  res.status(204).end()
})

app.get('/api/chats', auth, (req: AuthRequest, res) => {
  const rows = db.prepare(`
    SELECT t.id AS taskId, t.title, s.name AS subject, tp.name AS topic, t.assignment, t.comment, t.price,
      t.selected_tutor_id AS selectedTutorId, u.email AS studentEmail, m.tutor_id AS tutorId,
      CASE WHEN t.student_id = ? THEN tu.email ELSE u.email END AS partnerEmail,
      MAX(m.created_at) AS lastAt, (SELECT body FROM messages m2 WHERE m2.task_id=t.id ORDER BY m2.id DESC LIMIT 1) AS lastMessage
    FROM tasks t JOIN subjects s ON s.id=t.subject_id JOIN topics tp ON tp.id=t.topic_id
      JOIN users u ON u.id=t.student_id JOIN messages m ON m.task_id=t.id JOIN users tu ON tu.id=m.tutor_id
    WHERE (t.student_id=? OR m.tutor_id=?) GROUP BY t.id, m.tutor_id ORDER BY lastAt DESC
  `).all(req.user?.id, req.user?.id, req.user?.id)
  res.json(rows)
})

app.use((_req, res) => res.status(404).json({ error: 'Не найдено' }))
void initializeDatabase().then(() => {
  app.listen(Number(process.env.PORT ?? 3001), () => console.log('LabMate API: http://localhost:3001'))
}).catch((error: unknown) => {
  console.error('Failed to initialize SQLite database', error)
  process.exitCode = 1
})
