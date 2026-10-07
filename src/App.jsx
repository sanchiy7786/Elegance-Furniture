import { useCallback, useEffect, useState } from 'react'
import {
  Activity, AlertCircle, Bell, Check, ChevronRight, CirclePlus, ClipboardList,
  Database, FilePlus2, FolderKanban, LayoutDashboard,
  LoaderCircle, LogOut, Plus, RefreshCw, Settings2, Trash2, X,
} from 'lucide-react'
import { createId, recordAudit, sheets } from './lib/googleSheets'

function parseFieldDefinitions(value) {
  const fields = value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)\s*:\s*(text|number|date|long text)$/i)
      const label = (match ? match[1] : line).trim()
      const rawType = (match?.[2] || 'text').toLowerCase()
      return { label, type: rawType === 'long text' ? 'textarea' : rawType }
    })

  if (fields.length === 0) throw new Error('Add at least one field to your module.')
  if (fields.length > 20) throw new Error('A module can have up to 20 fields.')
  if (fields.some((field) => !field.label)) throw new Error('Field names cannot be blank.')
  if (fields.some((field) => ['recordId', 'createdAt', 'updatedAt'].some((reserved) => reserved.toLowerCase() === field.label.toLowerCase()))) {
    throw new Error('The field names recordId, createdAt, and updatedAt are reserved.')
  }
  if (new Set(fields.map((field) => field.label.toLowerCase())).size !== fields.length) {
    throw new Error('Field names must be unique.')
  }
  return fields
}

function StatusMessage({ error, onDismiss }) {
  if (!error) return null
  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <span>{error}</span>
      <button className="ml-auto text-rose-600" onClick={onDismiss} aria-label="Dismiss error"><X size={16} /></button>
    </div>
  )
}

function Modal({ title, description, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Customize your workspace</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function CreateModuleModal({ onClose, onCreate, saving }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldText, setFieldText] = useState('')
  const [error, setError] = useState('')
  const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10'

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const fields = parseFieldDefinitions(fieldText)
      await onCreate({ name: name.trim(), description: description.trim(), fields })
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <Modal title="Add a module" description="Choose the name and fields that fit your workflow." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-semibold text-slate-600">Module name<input required autoFocus maxLength={50} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="For example, Custom requests" /></label>
        <label className="block text-xs font-semibold text-slate-600">Description <span className="font-normal text-slate-400">(optional)</span><input maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} placeholder="What will this module track?" /></label>
        <label className="block text-xs font-semibold text-slate-600">Fields <span className="font-normal text-slate-400">(one per line)</span>
          <textarea required rows={6} value={fieldText} onChange={(event) => setFieldText(event.target.value)} className={`${inputClass} resize-y`} placeholder={'Item name\nQuantity: number\nNeeded by: date\nDetails: long text'} />
        </label>
        <p className="text-xs leading-5 text-slate-400">Supported field types: text, number, date, and long text. If you leave out a type, it defaults to text.</p>
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />} Create module
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RecordModal({ module, onClose, onCreate, saving }) {
  const [values, setValues] = useState({})
  const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10'
  const submit = (event) => {
    event.preventDefault()
    onCreate(values)
  }

  return (
    <Modal title={`Add to ${module.name}`} description="Fill in the fields configured for this module." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {module.fields.map((field) => (
          <label key={field.label} className="block text-xs font-semibold text-slate-600">
            {field.label}
            {field.type === 'textarea'
              ? <textarea rows={3} value={values[field.label] || ''} onChange={(event) => setValues((current) => ({ ...current, [field.label]: event.target.value }))} className={`${inputClass} resize-y`} />
              : <input type={['text', 'number', 'date'].includes(field.type) ? field.type : 'text'} value={values[field.label] || ''} onChange={(event) => setValues((current) => ({ ...current, [field.label]: event.target.value }))} className={inputClass} />}
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <FilePlus2 size={16} />} Save record
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function App() {
  const [page, setPage] = useState('overview')
  const [selectedModule, setSelectedModule] = useState(null)
  const [connected, setConnected] = useState(sheets.isConnected)
  const [identity, setIdentity] = useState(sheets.identity)
  const [modules, setModules] = useState([])
  const [archivedModules, setArchivedModules] = useState([])
  const [records, setRecords] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState('')
  const [syncTime, setSyncTime] = useState('')

  const reload = useCallback(async () => {
    if (!sheets.isConnected) return
    setLoading(true)
    setError('')
    try {
      const [moduleRows, logs] = await Promise.all([
        sheets.list('ModuleConfig'),
        sheets.list('ActivityLog'),
      ])
      const parsedModules = moduleRows.map((row) => {
        let fields
        try {
          fields = JSON.parse(row.fields)
        } catch {
          throw new Error(`Module "${row.name}" has invalid field configuration in the ModuleConfig tab.`)
        }
        if (!Array.isArray(fields) || fields.some((field) => !field.label || !field.type)) {
          throw new Error(`Module "${row.name}" has invalid field configuration in the ModuleConfig tab.`)
        }
        return { ...row, fields, active: String(row.active).toLowerCase() !== 'false' }
      })
      setModules(parsedModules.filter((module) => module.active))
      setArchivedModules(parsedModules.filter((module) => !module.active))
      setAuditLog(logs.reverse())
      setSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (cause) {
      setError(cause.message || 'Could not load module configuration from Sheets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connected) reload()
  }, [connected, reload])

  const connect = async () => {
    setLoading(true)
    setError('')
    try {
      const user = await sheets.connect()
      setIdentity(user)
      setConnected(true)
    } catch (cause) {
      setError(cause.message || 'Google Sheets connection failed.')
      setLoading(false)
    }
  }

  const disconnect = () => {
    sheets.disconnect()
    setConnected(false)
    setIdentity(null)
    setModules([])
    setArchivedModules([])
    setRecords([])
    setAuditLog([])
    setSyncTime('')
  }

  const withSave = async (operation) => {
    setSaving(true)
    setError('')
    try {
      await operation()
      await reload()
    } catch (cause) {
      setError(cause.message || 'The change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const openModule = async (module) => {
    setSelectedModule(module)
    setPage('module')
    setRecords([])
    setLoading(true)
    setError('')
    try {
      const result = await sheets.listModuleRecords(module)
      setRecords(result.reverse())
    } catch (cause) {
      setError(cause.message || `Could not load ${module.name}.`)
    } finally {
      setLoading(false)
    }
  }

  const createModule = (details) => withSave(async () => {
    if (!details.name) throw new Error('Enter a name for your module.')
    if ([...modules, ...archivedModules].some((module) => module.name.toLowerCase() === details.name.toLowerCase())) {
      throw new Error('A module with this name already exists.')
    }
    const module = {
      moduleId: createId('MOD'),
      name: details.name,
      description: details.description,
      fields: JSON.stringify(details.fields),
      active: 'TRUE',
      createdAt: new Date().toISOString(),
    }
    const parsedModule = { ...module, fields: details.fields, active: true }
    await sheets.ensureModuleSheet(parsedModule)
    await sheets.append('ModuleConfig', module)
    await recordAudit('Created module', 'Module', module.moduleId)
    setModal('')
    setPage('modules')
  })

  const createRecord = (values) => withSave(async () => {
    const record = await sheets.appendModuleRecord(selectedModule, values)
    await recordAudit('Created module record', selectedModule.name, record.recordId)
    setRecords((current) => [record, ...current])
    setModal('')
  })

  const archiveModule = (module) => withSave(async () => {
    await sheets.update('ModuleConfig', 'moduleId', module.moduleId, { active: 'FALSE' })
    await recordAudit('Removed module from workspace', 'Module', module.moduleId)
    if (selectedModule?.moduleId === module.moduleId) {
      setSelectedModule(null)
      setPage('modules')
    }
  })

  const restoreModule = (module) => withSave(async () => {
    await sheets.update('ModuleConfig', 'moduleId', module.moduleId, { active: 'TRUE' })
    await recordAudit('Restored module to workspace', 'Module', module.moduleId)
  })

  const currentLabel = page === 'overview'
    ? 'Overview'
    : page === 'modules'
      ? 'Configure modules'
      : page === 'audit'
        ? 'Activity log'
        : selectedModule?.name || 'Module'

  return (
    <div className="min-h-screen bg-[#f6f8f6] text-slate-800 lg:flex">
      <aside className="flex shrink-0 flex-col bg-[#11251d] text-white lg:sticky lg:top-0 lg:h-screen lg:w-[250px]">
        <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-[#10231b]"><FolderKanban size={21} /></div>
          <div><div className="font-semibold tracking-wide">AATHVAN <span className="text-emerald-400">ERP</span></div><div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-100/50">Your factory workspace</div></div>
        </div>
        <div className="px-5 pb-3 pt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Workspace</div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          <button onClick={() => setPage('overview')} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${page === 'overview' ? 'bg-emerald-500 text-[#10231b]' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}><LayoutDashboard size={17} /> Overview</button>
          {modules.map((module) => <button key={module.moduleId} onClick={() => openModule(module)} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${page === 'module' && selectedModule?.moduleId === module.moduleId ? 'bg-emerald-500 text-[#10231b]' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}><Database size={17} /><span className="max-w-40 truncate">{module.name}</span></button>)}
          <button onClick={() => setPage('modules')} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${page === 'modules' ? 'bg-emerald-500 text-[#10231b]' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}><Settings2 size={17} /> Configure modules</button>
          <button onClick={() => setPage('audit')} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${page === 'audit' ? 'bg-emerald-500 text-[#10231b]' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}><Activity size={17} /> Activity log</button>
        </nav>
        <div className="mt-auto hidden border-t border-white/10 p-4 lg:block">
          <div className="flex items-center gap-2 text-xs text-white/55"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />{connected ? 'Google Sheets connected' : 'Not connected'}</div>
          <p className="mt-2 truncate text-[11px] text-white/35">{identity?.email || 'Connect to your workspace'}</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur md:px-8">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Workspace / {currentLabel}</p>
            <p className="mt-1 text-sm font-medium text-slate-500">{connected ? `Signed in as ${identity?.email || 'Google user'}` : 'Google Sheets is the source of truth'}</p>
          </div>
          <div className="flex items-center gap-2">
            {connected && <span className="hidden text-xs text-slate-400 sm:block">{syncTime ? `Synced ${syncTime}` : 'Connected'}</span>}
            <button onClick={connected ? reload : connect} disabled={loading || (!connected && !sheets.isConfigured)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
              {loading ? <LoaderCircle size={16} className="animate-spin" /> : connected ? <RefreshCw size={15} /> : <Activity size={15} />}{connected ? 'Sync' : 'Connect Google'}
            </button>
            {connected && <button onClick={disconnect} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50" title="Disconnect Google account"><LogOut size={16} /></button>}
            <button className="hidden rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50 sm:inline-flex" title="Notifications"><Bell size={16} /></button>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] p-5 md:p-8">
          <StatusMessage error={error} onDismiss={() => setError('')} />
          {!connected ? (
            <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="grid md:grid-cols-[1.1fr_.9fr]">
                <div className="p-7 md:p-10">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><Database size={24} /></div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Configurable workspace</p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Build a workspace around your process.</h1>
                  <p className="mt-4 text-sm leading-6 text-slate-500">Create the modules and fields you need. Add to, remove, or restore modules without editing the application.</p>
                  {!sheets.isConfigured && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-900"><strong>Setup required:</strong> Add your Google OAuth client ID and spreadsheet ID to <code>.env.local</code>. Follow the setup steps in README.</div>}
                  <button onClick={connect} disabled={loading || !sheets.isConfigured} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#11251d] px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">
                    {loading ? <LoaderCircle size={17} className="animate-spin" /> : <Activity size={17} />} Connect Google Sheet
                  </button>
                  <p className="mt-3 text-xs text-slate-400">Your Google account must have access to the workbook.</p>
                </div>
                <div className="bg-[#11251d] p-7 text-white md:p-9">
                  <h2 className="font-semibold">Make it yours</h2>
                  <ul className="mt-5 space-y-4 text-sm text-white/75">
                    {['Name each module to match your process', 'Choose the fields and field types', 'Add or remove modules as needs change', 'Your data stays in your Google Sheet'].map((item) => <li key={item} className="flex gap-3"><Check size={17} className="shrink-0 text-emerald-400" />{item}</li>)}
                  </ul>
                  <div className="mt-8 border-t border-white/10 pt-4 text-xs leading-5 text-white/45">Removing a module archives it in the workspace. Its sheet and records remain in the workbook and can be restored later.</div>
                </div>
              </div>
            </div>
          ) : page === 'overview' ? (
            <>
              <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Your configurable workspace</p><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Make the workspace yours.</h1><p className="mt-1 text-sm text-slate-500">Create modules around the work your team actually does.</p></div>
                <button onClick={() => setModal('module')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"><Plus size={16} /> Add a module</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <button onClick={() => setPage('modules')} className="flex min-h-44 flex-col items-start justify-between rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-left transition hover:border-emerald-500 hover:bg-emerald-50/40">
                  <span className="rounded-xl bg-slate-100 p-2.5 text-slate-600"><Settings2 size={19} /></span><span><span className="block font-semibold text-slate-800">Configure modules</span><span className="mt-1 block text-sm text-slate-500">Add, remove, or restore modules</span></span>
                </button>
                {modules.map((module) => <button key={module.moduleId} onClick={() => openModule(module)} className="group flex min-h-44 flex-col items-start justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm shadow-slate-900/[0.02] transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
                  <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-800"><Database size={19} /></span>
                  <span className="w-full"><span className="flex items-center justify-between gap-2 font-semibold text-slate-900">{module.name}<ChevronRight size={16} className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-emerald-700" /></span><span className="mt-1 block line-clamp-2 text-sm text-slate-500">{module.description || `${module.fields.length} configured field${module.fields.length === 1 ? '' : 's'}`}</span><span className="mt-3 block text-xs text-slate-400">{module.fields.length} fields</span></span>
                </button>)}
                {modules.length === 0 && <div className="flex min-h-44 flex-col items-start justify-between rounded-2xl border border-slate-200 bg-white p-5"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><CirclePlus size={19} /></span><span><span className="block font-semibold text-slate-800">Start with a module</span><span className="mt-1 block text-sm text-slate-500">Add your first module and decide which fields it needs.</span></span></div>}
              </div>
              <div className="mt-7 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500"><ClipboardList size={18} className="mt-0.5 shrink-0 text-emerald-700" /><p><strong className="text-slate-700">Your workbook, your structure.</strong> Each module gets its own sheet tab with the fields you define. Removing a module hides it from the workspace but keeps its data for later restoration.</p></div>
            </>
          ) : !connected ? null : page === 'modules' ? (
            <>
              <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Workspace setup</p><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Configure modules</h1><p className="mt-1 text-sm text-slate-500">Choose what appears in your workspace. Your module records stay in Google Sheets.</p></div>
                <button onClick={() => setModal('module')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"><Plus size={16} /> Add module</button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Active modules <span className="ml-1 text-sm font-normal text-slate-400">{modules.length}</span></h2></div>
                {modules.length ? <div className="divide-y divide-slate-100">{modules.map((module) => <div key={module.moduleId} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-800"><Database size={18} /></span><div className="min-w-0"><p className="font-semibold text-slate-900">{module.name}</p><p className="truncate text-sm text-slate-500">{module.description || `${module.fields.length} fields: ${module.fields.map((field) => field.label).join(', ')}`}</p></div></div><button onClick={() => archiveModule(module)} disabled={saving} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><Trash2 size={15} /> Remove</button></div>)}</div> : <p className="px-5 py-10 text-center text-sm text-slate-400">No active modules. Add one to shape your workspace.</p>}
              </div>
              {archivedModules.length > 0 && <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Removed modules <span className="ml-1 text-sm font-normal text-slate-400">{archivedModules.length}</span></h2><p className="mt-1 text-xs text-slate-400">Their records are preserved and can be restored at any time.</p></div><div className="divide-y divide-slate-100">{archivedModules.map((module) => <div key={module.moduleId} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="font-medium text-slate-700">{module.name}</p><p className="text-xs text-slate-400">{module.fields.length} fields · data preserved</p></div><button onClick={() => restoreModule(module)} disabled={saving} className="rounded-xl bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Restore</button></div>)}</div></div>}
            </>
          ) : page === 'audit' ? (
            <>
              <div className="mb-6"><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Workspace activity</p><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activity log</h1><p className="mt-1 text-sm text-slate-500">Module changes and record creation events.</p></div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr>{['Event', 'Time', 'Google account', 'Action', 'Record'].map((heading) => <th key={heading} className="whitespace-nowrap px-5 py-3.5">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{auditLog.length ? auditLog.map((log) => <tr key={log.auditId}><td className="px-5 py-4 font-semibold text-slate-900">{log.auditId}</td><td className="px-5 py-4 text-slate-600">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</td><td className="px-5 py-4 text-slate-600">{log.actor}</td><td className="px-5 py-4 text-slate-600">{log.action}</td><td className="px-5 py-4 text-slate-600">{log.entity} {log.entityId}</td></tr>) : <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">No activity to show yet.</td></tr>}</tbody></table></div>
            </>
          ) : page === 'module' && selectedModule ? (
            <>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Custom module</p><h1 className="text-2xl font-semibold tracking-tight text-slate-900">{selectedModule.name}</h1><p className="mt-1 text-sm text-slate-500">{selectedModule.description || `Your custom records · ${selectedModule.fields.length} fields`}</p></div>
                <button onClick={() => setModal('record')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"><Plus size={16} /> Add record</button>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr>{[...selectedModule.fields.map((field) => field.label), 'Created'].map((heading) => <th key={heading} className="whitespace-nowrap px-5 py-3.5">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.length ? records.map((record) => <tr key={record.recordId}>{selectedModule.fields.map((field) => <td key={field.label} className="max-w-xs whitespace-pre-wrap px-5 py-4 text-slate-600">{record[field.label] || '—'}</td>)}<td className="whitespace-nowrap px-5 py-4 text-slate-400">{record.createdAt ? new Date(record.createdAt).toLocaleDateString() : '—'}</td></tr>) : <tr><td colSpan={selectedModule.fields.length + 1} className="px-5 py-12 text-center text-sm text-slate-400">{loading ? 'Loading records…' : 'No records yet. Add your first record to this module.'}</td></tr>}</tbody></table></div>
            </>
          ) : null}
        </main>
      </div>

      {modal === 'module' && <CreateModuleModal onClose={() => setModal('')} onCreate={createModule} saving={saving} />}
      {modal === 'record' && selectedModule && <RecordModal module={selectedModule} onClose={() => setModal('')} onCreate={createRecord} saving={saving} />}
      {loading && connected && <div className="pointer-events-none fixed bottom-5 right-5 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg"><LoaderCircle size={14} className="animate-spin" /> Syncing workspace</div>}
    </div>
  )
}
