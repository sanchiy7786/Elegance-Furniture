const API_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets'
const IDENTITY_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GIS_URL = 'https://accounts.google.com/gsi/client'
const SHEET_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ')

export const TABLES = {
  ModuleConfig: ['moduleId', 'name', 'description', 'fields', 'active', 'createdAt'],
  ActivityLog: ['auditId', 'timestamp', 'actor', 'action', 'entity', 'entityId'],
}

let gisPromise

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise

  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_URL
    script.async = true
    script.defer = true
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve()
      : reject(new Error('Google sign-in could not be initialized. Please reload and try again.'))
    script.onerror = () => reject(new Error('Google sign-in could not be loaded. Check your internet connection.'))
    document.head.appendChild(script)
  })

  return gisPromise
}

function columnName(index) {
  let number = index + 1
  let name = ''
  while (number > 0) {
    const remainder = (number - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    number = Math.floor((number - 1) / 26)
  }
  return name
}

export class GoogleSheetsClient {
  constructor(clientId, spreadsheetId) {
    this.clientId = clientId
    this.spreadsheetId = spreadsheetId
    this.accessToken = null
    this.tokenExpiresAt = 0
    this.identity = null
  }

  get isConfigured() {
    return Boolean(this.clientId && this.spreadsheetId)
  }

  get isConnected() {
    return Boolean(this.accessToken && this.identity)
  }

  async connect() {
    if (!this.isConfigured) {
      throw new Error('Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_SHEET_ID to .env.local, then restart the app.')
    }

    await loadGoogleIdentityServices()
    const tokenResponse = await new Promise((resolve, reject) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SHEET_SCOPES,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error))
            return
          }
          resolve(response)
        },
        error_callback: (error) => reject(new Error(error.message || 'Google sign-in was cancelled.')),
      })
      tokenClient.requestAccessToken({ prompt: '' })
    })

    this.accessToken = tokenResponse.access_token
    this.tokenExpiresAt = Date.now() + Number(tokenResponse.expires_in || 3600) * 1000
    try {
      const response = await fetch(IDENTITY_URL, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      if (!response.ok) throw new Error(`Google account lookup failed (${response.status}).`)
      this.identity = await response.json()
      await this.ensureTables()
      return this.identity
    } catch (error) {
      this.disconnect()
      throw error
    }
  }

  disconnect() {
    if (this.accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(this.accessToken, () => {})
    }
    this.accessToken = null
    this.tokenExpiresAt = 0
    this.identity = null
  }

  async request(path, options = {}) {
    if (!this.accessToken) throw new Error('Connect a Google account to access the factory sheet.')
    if (Date.now() >= this.tokenExpiresAt - 30_000) {
      this.disconnect()
      throw new Error('Your Google session has expired. Connect your Google account again to continue.')
    }
    const response = await fetch(`${API_ROOT}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = result.error?.message || `Google Sheets request failed (${response.status}).`
      throw new Error(message)
    }
    return result
  }

  async ensureTables() {
    const metadata = await this.request('?fields=sheets.properties.title')
    const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties.title))
    const missing = Object.keys(TABLES).filter((name) => !existing.has(name))

    if (missing.length) {
      await this.request(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      })
    }

    for (const [title, headers] of Object.entries(TABLES)) {
      const result = await this.request(`/values/${encodeURIComponent(`${title}!1:1`)}`)
      const currentHeaders = result.values?.[0] || []
      if (currentHeaders.length === 0) {
        await this.request(`/values/${encodeURIComponent(`${title}!A1:${columnName(headers.length - 1)}1`)}?valueInputOption=RAW`, {
          method: 'PUT',
          body: JSON.stringify({ values: [headers] }),
        })
      } else if (headers.some((header, index) => currentHeaders[index] !== header)) {
        throw new Error(`The ${title} tab has unexpected columns. Keep its first row as: ${headers.join(', ')}.`)
      }
    }
  }

  async list(table) {
    this.assertTable(table)
    const result = await this.request(`/values/${encodeURIComponent(`${table}!A:Z`)}`)
    const [headers = [], ...rows] = result.values || []
    return rows
      .filter((row) => row.some((value) => value !== ''))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  }

  async append(table, record) {
    this.assertTable(table)
    const headers = TABLES[table]
    const row = headers.map((header) => record[header] ?? '')
    await this.request(`/values/${encodeURIComponent(`${table}!A:${columnName(headers.length - 1)}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: [row] }),
    })
    return record
  }

  async update(table, idField, recordId, updates) {
    this.assertTable(table)
    const result = await this.request(`/values/${encodeURIComponent(`${table}!A:Z`)}`)
    const [headers = [], ...rows] = result.values || []
    const idColumn = headers.indexOf(idField)
    if (idColumn < 0) throw new Error(`The ${table} tab is missing the ${idField} column.`)
    const rowIndex = rows.findIndex((row) => row[idColumn] === recordId)
    if (rowIndex < 0) throw new Error(`${table} record ${recordId} was not found.`)
    const rowNumber = rowIndex + 2
    const columnHeaders = TABLES[table]
    const updatedRecord = { ...Object.fromEntries(columnHeaders.map((header, index) => [header, rows[rowIndex][index] ?? ''])), ...updates }
    const row = columnHeaders.map((header) => updatedRecord[header] ?? '')
    await this.request(`/values/${encodeURIComponent(`${table}!A${rowNumber}:${columnName(columnHeaders.length - 1)}${rowNumber}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [row] }),
    })
    return updatedRecord
  }

  moduleSheetName(moduleId) {
    if (!/^MOD-\d{8}-[A-F0-9]{6}$/.test(moduleId)) throw new Error('This module has an invalid identifier.')
    return `Module_${moduleId.replaceAll('-', '_')}`
  }

  async ensureModuleSheet(module) {
    const sheetName = this.moduleSheetName(module.moduleId)
    const metadata = await this.request('?fields=sheets.properties.title')
    const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties.title))
    const headers = ['recordId', ...module.fields.map((field) => field.label), 'createdAt', 'updatedAt']

    if (!existing.has(sheetName)) {
      await this.request(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
      })
    }

    const result = await this.request(`/values/${encodeURIComponent(`${sheetName}!1:1`)}`)
    const currentHeaders = result.values?.[0] || []
    if (currentHeaders.length === 0) {
      await this.request(`/values/${encodeURIComponent(`${sheetName}!A1:${columnName(headers.length - 1)}1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: [headers] }),
      })
    } else if (headers.some((header, index) => currentHeaders[index] !== header) || currentHeaders.length !== headers.length) {
      throw new Error(`The ${sheetName} tab columns do not match this module. Avoid editing its header row.`)
    }
    return sheetName
  }

  async listModuleRecords(module) {
    const sheetName = await this.ensureModuleSheet(module)
    const result = await this.request(`/values/${encodeURIComponent(`${sheetName}!A:Z`)}`)
    const [headers = [], ...rows] = result.values || []
    return rows
      .filter((row) => row.some((value) => value !== ''))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  }

  async appendModuleRecord(module, values) {
    const sheetName = await this.ensureModuleSheet(module)
    const headers = ['recordId', ...module.fields.map((field) => field.label), 'createdAt', 'updatedAt']
    const record = {
      recordId: createId('REC'),
      ...values,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await this.request(`/values/${encodeURIComponent(`${sheetName}!A:${columnName(headers.length - 1)}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: [headers.map((header) => record[header] ?? '')] }),
    })
    return record
  }

  assertTable(table) {
    if (!Object.hasOwn(TABLES, table)) throw new Error(`Unknown factory sheet tab: ${table}.`)
  }
}

export const sheets = new GoogleSheetsClient(
  import.meta.env.VITE_GOOGLE_CLIENT_ID,
  import.meta.env.VITE_GOOGLE_SHEET_ID,
)

export function createId(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
}

export async function recordAudit(action, entity, entityId) {
  if (!sheets.isConnected) return
  await sheets.append('ActivityLog', {
    auditId: createId('LOG'),
    timestamp: new Date().toISOString(),
    actor: sheets.identity?.email || 'Google user',
    action,
    entity,
    entityId,
  })
}
