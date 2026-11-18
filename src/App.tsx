import { type FormEvent, useEffect, useMemo, useState } from 'react'
import './App.css'

type Role = 'student' | 'tutor'
type User = { id: number; email: string; role: Role }
type Task = { id: number; title: string; subject: string; topic: string; assignment: string; comment: string; price: number; selectedTutorId: number | null; studentEmail: string; applications: number; firstMessage?: string }
type ChatSummary = { taskId: number; title: string; subject: string; topic: string; assignment: string; comment: string; price: number; selectedTutorId: number | null; studentEmail: string; tutorId: number; partnerEmail: string; lastAt: string; lastMessage: string }
type Catalog = { subjects: string[]; topics: string[] }
type Chat = { tutorId: number; tutorEmail: string; messages: Message[] }
type Message = { id: number; body: string; senderId: number; createdAt: string }

const API = '/api'
const fallbackCatalog: Catalog = { subjects: ['Математика', 'Программирование', 'Английский язык', 'Физика', 'Дизайн'], topics: ['Производные', 'Алгоритмы', 'Грамматика', 'Механика'] }

async function request<T>(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('labmate-token')
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  if (!response.ok) throw new Error((await response.json()).error ?? 'Что-то пошло не так')
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? response.json() as Promise<T> : undefined as T
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<Role>('student')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('labmate-user')
    if (saved) {
      const current = JSON.parse(saved) as User
      setUser(current)
      setMode('student')
    }
  }, [])

  async function handleAuth(email: string, password: string) {
    setError('')
    try {
      const data = await request<{ token: string; user: User }>(`/auth/${authMode}`, { method: 'POST', body: JSON.stringify({ email, password }) })
      localStorage.setItem('labmate-token', data.token)
      localStorage.setItem('labmate-user', JSON.stringify(data.user))
      setUser(data.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти')
    }
  }

  if (!user) return <AuthScreen mode={authMode} error={error} onModeChange={setAuthMode} onSubmit={handleAuth} />
  return <Dashboard user={user} mode={mode} onModeChange={setMode} onLogout={() => { localStorage.clear(); setUser(null) }} />
}

function AuthScreen({ mode, error, onModeChange, onSubmit }: { mode: 'login' | 'register'; error: string; onModeChange: (mode: 'login' | 'register') => void; onSubmit: (email: string, password: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand"><span className="brand-mark">L</span><span>Lab<span>Mate</span></span></div>
        <div className="auth-copy">
          <p className="eyebrow">Учись с поддержкой</p>
          <h1>{mode === 'login' ? 'С возвращением' : 'Создай аккаунт'}</h1>
          <p>{mode === 'login' ? 'Продолжи путь к своим учебным целям.' : 'Найди помощника или помоги другим учиться.'}</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(email, password) }}>
          <label>Email<input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Пароль<input type="password" placeholder="Минимум 6 символов" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button wide" type="submit">{mode === 'login' ? 'Войти в LabMate' : 'Зарегистрироваться'} <span>→</span></button>
        </form>
        <p className="auth-switch">{mode === 'login' ? 'Ещё нет аккаунта?' : 'Уже есть аккаунт?'} <button type="button" onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Создать' : 'Войти'}</button></p>
      </div>
      <div className="auth-art"><div className="orb orb-one" /><div className="orb orb-two" /><div className="art-note">«Каждая задача<br />становится проще,<br /><strong>когда ты не один.</strong>»</div><div className="art-caption">ТВОЙ ПРОСТРАНСТВО<br />ДЛЯ РОСТА</div></div>
    </main>
  )
}

function Dashboard({ user, mode, onModeChange, onLogout }: { user: User; mode: Role; onModeChange: (mode: Role) => void; onLogout: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [page, setPage] = useState<'tasks' | 'chats'>('tasks')
  const [catalog, setCatalog] = useState(fallbackCatalog)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [topic, setTopic] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [notice, setNotice] = useState('')

  async function loadTasks() {
    try {
      const params = new URLSearchParams({ view: mode })
      if (topic) params.set('topic', topic)
      if (minPrice) params.set('minPrice', minPrice)
      setTasks(await request<Task[]>(`/tasks?${params}`))
      setCatalog(await request<Catalog>('/catalog'))
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не удалось загрузить задачи')
    }
  }
  useEffect(() => { void loadTasks() }, [mode, topic, minPrice])
  async function loadChats() {
    try { setChats(await request<ChatSummary[]>('/chats')) } catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Не удалось загрузить чаты') }
  }
  useEffect(() => { if (page === 'chats') void loadChats() }, [page])
  const filteredTasks = useMemo(() => tasks.filter((task) => `${task.title} ${task.subject} ${task.topic} ${task.assignment}`.toLowerCase().includes(search.toLowerCase())), [tasks, search])

  async function deleteTask(id: number) {
    try { await request(`/tasks/${id}`, { method: 'DELETE' }); setTasks((items) => items.filter((task) => task.id !== id)) } catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Не удалось удалить задачу') }
  }

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">L</span><span>Lab<span>Mate</span></span></div><nav><button className={mode === 'student' && page === 'tasks' ? 'active' : ''} onClick={() => { onModeChange('student'); setPage('tasks') }}>Для студента</button><button className={mode === 'tutor' && page === 'tasks' ? 'active' : ''} onClick={() => { onModeChange('tutor'); setPage('tasks') }}>Для помощника</button><button className={page === 'chats' ? 'active' : ''} onClick={() => setPage('chats')}>Чаты</button></nav><div className="profile"><span className="avatar">{user.email[0].toUpperCase()}</span><span className="profile-email">{user.email}</span><button className="logout" onClick={onLogout} aria-label="Выйти">↗</button></div></header>
      <main className="dashboard">
        {page !== 'chats' && <section className="welcome"><div><p className="eyebrow">{mode === 'student' ? 'ЛИЧНЫЙ КАБИНЕТ' : 'РАБОЧИЙ СТОЛ ПОМОЩНИКА'}</p><h1>{mode === 'student' ? <>Привет, <em>исследователь.</em></> : <>Найди задачу,<br /><em>которую решишь.</em></>}</h1><p className="muted">{mode === 'student' ? 'Опиши, что изучаешь — и найди того, кто поможет разобраться.' : 'Помогай студентам двигаться вперёд и делись своим опытом.'}</p></div><div className="welcome-mark">{mode === 'student' ? '✦' : '↗'}</div></section>}
        {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        {page === 'chats' ? <ChatsView chats={chats} userId={user.id} onChanged={loadChats} /> : mode === 'student' ? <StudentView tasks={filteredTasks} topics={catalog.topics} onCreate={() => setShowCreate(true)} onDelete={deleteTask} onOpen={setSelectedTask} /> : <TutorView tasks={filteredTasks} topics={catalog.topics} search={search} topic={topic} minPrice={minPrice} onSearch={setSearch} onTopic={setTopic} onMinPrice={setMinPrice} onOpen={setSelectedTask} />}
      </main>
      {showCreate && <CreateTask catalog={catalog} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void loadTasks() }} />}
      {selectedTask && <TaskDrawer task={selectedTask} mode={mode} onClose={() => setSelectedTask(null)} onUpdated={() => { setSelectedTask(null); void loadTasks(); void loadChats() }} />}
    </div>
  )
}

function StudentView({ tasks, topics, onCreate, onDelete, onOpen }: { tasks: Task[]; topics: string[]; onCreate: () => void; onDelete: (id: number) => void; onOpen: (task: Task) => void }) {
  return <><div className="section-heading"><div><h2>Мои задачи <span className="count">{tasks.length}</span></h2><p className="muted">Здесь появятся отклики и чаты помощников.</p></div><button className="primary-button" onClick={onCreate}>+ Новая задача</button></div><div className="task-grid">{tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} student onOpen={onOpen} onDelete={onDelete} />) : <EmptyState onCreate={onCreate} />}</div><div className="topic-strip"><span>Популярные темы</span>{topics.slice(0, 5).map((item) => <span className="topic-pill" key={item}>{item}</span>)}</div></>
}

function TutorView({ tasks, topics, search, topic, minPrice, onSearch, onTopic, onMinPrice, onOpen }: { tasks: Task[]; topics: string[]; search: string; topic: string; minPrice: string; onSearch: (value: string) => void; onTopic: (value: string) => void; onMinPrice: (value: string) => void; onOpen: (task: Task) => void }) {
  return <><div className="filter-bar"><div className="search"><span>⌕</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Поиск по задачам" /></div><select value={topic} onChange={(event) => onTopic(event.target.value)}><option value="">Все темы</option>{topics.map((item) => <option key={item}>{item}</option>)}</select><label className="price-filter">от <input type="number" value={minPrice} onChange={(event) => onMinPrice(event.target.value)} placeholder="цена" /> ₽</label></div><div className="section-heading"><div><h2>Лента задач <span className="count">{tasks.length}</span></h2><p className="muted">Выбери задачу, где твой опыт будет полезен.</p></div></div><div className="task-grid">{tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />) : <div className="empty-card">По этим фильтрам задач нет.</div>}</div></>
}

function ChatsView({ chats, userId, onChanged }: { chats: ChatSummary[]; userId: number; onChanged: () => Promise<void> }) {
  const [active, setActive] = useState<ChatSummary | null>(chats[0] ?? null)
  useEffect(() => { if (!active || !chats.some((chat) => chat.taskId === active.taskId && chat.tutorId === active.tutorId)) setActive(chats[0] ?? null) }, [chats, active])
  if (!chats.length) return <div className="empty-card standalone-empty"><div className="empty-icon">✦</div><h3>Чатов пока нет</h3><p>Здесь появятся отдельные переписки по задачам.</p></div>
  return <section className="messenger"><aside className="chat-sidebar"><div className="chat-sidebar-heading"><div><p className="eyebrow">ПЕРЕПИСКИ</p><h2>Все чаты <span className="count">{chats.length}</span></h2></div></div><div className="chat-sidebar-list">{chats.map((chat) => <button className={`chat-list-item ${active?.taskId === chat.taskId && active.tutorId === chat.tutorId ? 'selected' : ''}`} key={`${chat.taskId}-${chat.tutorId}`} onClick={() => setActive(chat)}><span className="avatar">{(chat.partnerEmail[0] ?? 'L').toUpperCase()}</span><span className="chat-list-content"><strong>{chat.partnerEmail}</strong><small>{chat.title}</small><span>{chat.lastMessage}</span></span><time>{new Date(chat.lastAt).toLocaleDateString('ru-RU')}</time></button>)}</div></aside><Messenger chat={active} userId={userId} onChanged={onChanged} /></section>
}

function Messenger({ chat, userId, onChanged }: { chat: ChatSummary | null; userId: number; onChanged: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([]); const [body, setBody] = useState(''); const [error, setError] = useState('')
  useEffect(() => { if (chat) void request<Chat[]>(`/tasks/${chat.taskId}/chats`).then((items) => setMessages(items.find((item) => item.tutorId === chat.tutorId)?.messages ?? [])).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить переписку')) }, [chat])
  async function send(event: FormEvent) { event.preventDefault(); if (!chat || !body.trim()) return; try { await request(`/tasks/${chat.taskId}/messages`, { method: 'POST', body: JSON.stringify({ tutorId: chat.tutorId, body: body.trim() }) }); setBody(''); const items = await request<Chat[]>(`/tasks/${chat.taskId}/chats`); setMessages(items.find((item) => item.tutorId === chat.tutorId)?.messages ?? []); await onChanged() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение') } }
  if (!chat) return <div className="messenger-empty">Выберите чат слева</div>
  return <div className="messenger-window"><header className="messenger-header"><div className="avatar">{(chat.partnerEmail[0] ?? 'L').toUpperCase()}</div><div><strong>{chat.partnerEmail}</strong><span>Чат по задаче: {chat.title}</span></div><span className="messenger-topic">{chat.subject} · {chat.topic}</span></header><div className="messenger-task"><strong>{chat.title}</strong><span>{chat.assignment}</span><b>{chat.price.toLocaleString('ru-RU')} ₽</b></div><div className="messenger-messages">{messages.map((message) => <div className={`messenger-message ${message.senderId === userId ? 'mine' : ''}`} key={message.id}><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleString('ru-RU')}</small></div>)}</div><form className="messenger-compose" onSubmit={send}><input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Написать сообщение..." /><button className="primary-button" type="submit">Отправить <span>↑</span></button></form>{error && <p className="form-error messenger-error">{error}</p>}</div>
}

function TaskCard({ task, student = false, onOpen, onDelete }: { task: Task; student?: boolean; onOpen: (task: Task) => void; onDelete?: (id: number) => void }) {
  return <article className="task-card" onClick={() => onOpen(task)} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onOpen(task)}><div className="card-top"><span className="topic-label">{task.subject} · {task.topic}</span><span className="price">{task.price.toLocaleString('ru-RU')} ₽</span></div><h3>{task.title}</h3><p>{task.assignment}</p>{task.comment && <p className="task-comment">Пометка: {task.comment}</p>}<div className="card-meta"><span className="student-name">{student ? 'Вы' : task.studentEmail}</span><span>{task.applications ? `${task.applications} отклика` : 'Пока без откликов'}</span></div><div className="card-actions">{student ? <><button className="text-button" onClick={(event) => { event.stopPropagation(); onOpen(task) }}>Открыть отклики <span>→</span></button><button className="delete-button" onClick={(event) => { event.stopPropagation(); onDelete?.(task.id) }}>Удалить</button></> : <button className="primary-button small" onClick={(event) => { event.stopPropagation(); onOpen(task) }}>Откликнуться <span>→</span></button>}</div></article>
}

function EmptyState({ onCreate }: { onCreate: () => void }) { return <div className="empty-card"><div className="empty-icon">✦</div><h3>Начни с первой задачи</h3><p>Опиши, что сейчас изучаешь, и помощники предложат свою поддержку.</p><button className="text-button" onClick={onCreate}>Создать задачу <span>→</span></button></div> }

function CreateTask({ catalog, onClose, onCreated }: { catalog: Catalog; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(''); const [subject, setSubject] = useState(''); const [topic, setTopic] = useState(''); const [assignment, setAssignment] = useState(''); const [comment, setComment] = useState(''); const [price, setPrice] = useState(''); const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); try { await request('/tasks', { method: 'POST', body: JSON.stringify({ title, subject, topic, assignment, comment, price: Number(price) }) }); onCreated() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать задачу') } }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><button className="close" type="button" onClick={onClose}>×</button><p className="eyebrow">НОВАЯ ЗАДАЧА</p><h2>С чем нужна помощь?</h2><p className="muted">Заполни детали — помощнику будет проще откликнуться.</p><label>Название<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, решить задачу по производным" required /></label><Autocomplete label="Предмет" value={subject} options={catalog.subjects} onChange={setSubject} placeholder="Начните вводить предмет" /><Autocomplete label="Тема" value={topic} options={catalog.topics} onChange={setTopic} placeholder="Начните вводить тему" /><label>Задание<textarea value={assignment} onChange={(event) => setAssignment(event.target.value)} placeholder="Подробно опишите задание" rows={4} required /></label><label>Комментарий <span className="optional">(необязательно)</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Дополнительные пометки для помощника" rows={2} /></label><label>Цена, ₽<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="1500" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button wide" type="submit">Опубликовать задачу <span>→</span></button></form></div>
}

function Autocomplete({ label, value, options, onChange, placeholder }: { label: string; value: string; options: string[]; onChange: (value: string) => void; placeholder: string }) {
  const [focused, setFocused] = useState(false)
  const matches = options.filter((option) => option.toLowerCase().includes(value.toLowerCase())).slice(0, 6)
  const showCreate = value.trim().length > 0 && !options.some((option) => option.toLowerCase() === value.trim().toLowerCase())
  return <label className="autocomplete-field">{label}<input value={value} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 120)} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required />{focused && (matches.length > 0 || showCreate) && <div className="suggestions">{matches.map((option) => <button type="button" key={option} onMouseDown={() => onChange(option)}>{option}</button>)}{showCreate && <button type="button" className="create-option" onMouseDown={() => onChange(value.trim())}>+ Добавить «{value.trim()}»</button>}</div>}</label>
}

function TaskDrawer({ task, mode, onClose, onUpdated }: { task: Task; mode: Role; onClose: () => void; onUpdated: () => void }) {
  const [message, setMessage] = useState(''); const [chat, setChat] = useState<Chat[]>([]); const [tutorId, setTutorId] = useState<number | null>(null); const [error, setError] = useState('')
  useEffect(() => { void request<Chat[]>(`/tasks/${task.id}/chats`).then(setChat).catch(() => undefined) }, [task.id])
  async function apply() { try { await request(`/tasks/${task.id}/apply`, { method: 'POST', body: JSON.stringify({ message }) }); onUpdated() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось отправить отклик') } }
  async function send() { if (!message || !tutorId) return; try { await request(`/tasks/${task.id}/messages`, { method: 'POST', body: JSON.stringify({ tutorId, body: message }) }); setMessage(''); const next = await request<Chat[]>(`/tasks/${task.id}/chats`); setChat(next) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение') } }
  async function selectTutor(id: number) { try { await request(`/tasks/${task.id}/select`, { method: 'POST', body: JSON.stringify({ tutorId: id }) }); onUpdated() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выбрать помощника') } }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="drawer">
      <button className="close" onClick={onClose}>×</button>
      <span className="topic-label">{task.subject} · {task.topic}</span>
      <h2>{task.title}</h2>
      <p className="drawer-description"><strong>Задание</strong><br />{task.assignment}</p>
      {task.comment && <p className="drawer-comment"><strong>Комментарий разместителя</strong><br />{task.comment}</p>}
      <div className="drawer-budget"><span>Бюджет</span><strong>{task.price.toLocaleString('ru-RU')} ₽</strong></div>
      <hr />
      <h3>{mode === 'tutor' && chat.length === 0 ? 'Твой отклик' : 'Переписка'}</h3>
      {mode === 'tutor' && chat.length === 0 ? (
        <>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Расскажи, как поможешь решить задачу..." rows={5} />
          <button className="primary-button wide" onClick={apply}>Отправить отклик <span>→</span></button>
        </>
      ) : (
        <>
          {chat.length ? chat.map((item) => (
            <div className="chat-block" key={item.tutorId}>
              <div className="chat-heading"><span className="avatar small">{item.tutorEmail[0].toUpperCase()}</span><strong>{item.tutorEmail}</strong>{mode === 'student' && !task.selectedTutorId && <button className="choose-button" onClick={() => selectTutor(item.tutorId)}>Выбрать</button>}</div>
              {item.messages.map((chatMessage) => <div className="message" key={chatMessage.id}><p>{chatMessage.body}</p><small>{new Date(chatMessage.createdAt).toLocaleString('ru-RU')}</small></div>)}
              {(!task.selectedTutorId || task.selectedTutorId === item.tutorId) && <div className="message-compose"><input value={tutorId === item.tutorId ? message : ''} onFocus={() => setTutorId(item.tutorId)} onChange={(event) => { setTutorId(item.tutorId); setMessage(event.target.value) }} placeholder="Написать сообщение..." /><button onClick={send}>↑</button></div>}
            </div>
          )) : <p className="muted">Пока никто не откликнулся. Загляни сюда позже.</p>}
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </aside>
  </div>
}

export default App
