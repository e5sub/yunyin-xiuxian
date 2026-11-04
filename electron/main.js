import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import pkg from '../package.json'

// package.json 没有 title 字段,取 electron-builder 的 productName
const APP_TITLE = pkg.build.productName

// 开发时是项目根目录,打包后是 app.asar
const appRoot = app.getAppPath()

const preloadPath = path.join(appRoot, 'dist-electron', 'preload.js')

const distPath = path.join(appRoot, 'dist')

const publicPath = path.join(appRoot, 'public')

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

const defaultSettings = {
  closeToTray: false,
  autoLaunch: false
}

const loadSettings = () => {
  try {
    if (fs.existsSync(settingsPath)) {
      return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) }
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return { ...defaultSettings }
}

const saveSettings = s => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2))
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

let settings = loadSettings()
let win = null
let tray = null
let isQuitting = false

const destroyTray = () => {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

const setAutoLaunch = enable => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: app.getPath('exe')
  })
}

const createTray = () => {
  if (tray) return

  const iconPath = path.join(publicPath, 'favicon.ico')
  const trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()

  tray = new Tray(trayIcon)
  tray.setToolTip(APP_TITLE)

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => win?.show() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => win?.show())
}

const createAppMenu = () => {
  const template = [
    {
      label: '设置',
      submenu: [
        {
          label: '关闭时最小化到托盘',
          type: 'checkbox',
          checked: settings.closeToTray,
          click: menuItem => {
            settings.closeToTray = menuItem.checked
            saveSettings(settings)
            if (settings.closeToTray) {
              createTray()
            } else {
              destroyTray()
            }
          }
        },
        {
          label: '开机自动启动',
          type: 'checkbox',
          checked: settings.autoLaunch,
          click: menuItem => {
            settings.autoLaunch = menuItem.checked
            saveSettings(settings)
            setAutoLaunch(settings.autoLaunch)
          }
        },
        {
          label: '退出游戏',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            isQuitting = true
            app.quit()
          }
        }
      ]
    },
    {
      label: '开发',
      submenu: [
        {
          label: '开发者工具',
          accelerator: 'F12',
          click: () => win?.webContents.toggleDevTools()
        },
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => win?.webContents.reload()
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/** 只在 http(s) 下交给系统浏览器;其它协议(javascript:/file:/自注册协议)一律丢弃 */
const openExternally = url => {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString())
  } catch {
    // 非法 URL:当作没点
  }
}

/** 页面内导航是否允许:只认 dist 目录下的构建产物(index.html 及其 hash 路由) */
const distUrlPrefix = pathToFileURL(distPath).href + '/'
const isLocalAppUrl = url => url.startsWith(distUrlPrefix)

const createWindow = () => {
  win = new BrowserWindow({
    title: APP_TITLE,
    icon: path.join(publicPath, 'favicon.ico'),
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // 显式声明:渲染进程跑在沙箱里,即使页面被注入脚本也拿不到 Node 能力
      sandbox: true,
      // 游戏不需要任何 <webview>
      webviewTag: false,
      preload: preloadPath
    }
  })

  createAppMenu()
  win.loadFile(path.join(distPath, 'index.html'))

  // 站内链接(关于页的 GitHub、隐私政策)一律丢给系统浏览器:在应用内开新窗口等于
  // 让外部页面拿到 preload 注入的 electronAPI(能写 settings.json、退出应用)。
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })

  // 顶层导航只允许留在本地页面:否则外部站点会在同一窗口接管应用外壳。
  win.webContents.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url)) return
    event.preventDefault()
    openExternally(url)
  })

  // 防御性:本项目不嵌入任何 webview,被附加即拒绝
  win.webContents.on('will-attach-webview', event => {
    event.preventDefault()
  })

  // 权限按白名单授予:只放行「写剪贴板」(设置页的诊断信息复制要用 navigator.clipboard.writeText),
  // 摄像头/麦克风/定位/通知/剪贴板读取/HID/USB 全拒。全拒之后,Chromium 侧那类
  // 「权限请求归属到错误来源」的漏洞也没有可触发的入口。
  const allowedPermission = permission => permission === 'clipboard-sanitized-write'
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowedPermission(permission))
  })
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => allowedPermission(permission))

  // WebDAV CORS 绕过:注入 CORS 响应头。
  // 作用域仍是整个 session(配置在渲染进程里,主进程拿不到用户填的 WebDAV 地址),
  // 所以外部页面一旦能进应用就会共享这份豁免 —— 上面两道导航闸门是这个前提的保证。
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['access-control-allow-origin'] = ['*']
    headers['access-control-allow-methods'] = ['GET, PUT, DELETE, PROPFIND, HEAD, OPTIONS']
    headers['access-control-allow-headers'] = ['Authorization, Content-Type, Depth']
    // 剥离 WWW-Authenticate,防止弹出原生认证对话框(认证错误由应用处理)
    delete headers['www-authenticate']
    delete headers['WWW-Authenticate']
    callback({ responseHeaders: headers })
  })

  win.on('close', e => {
    if (settings.closeToTray && !isQuitting) {
      e.preventDefault()
      win.hide()
      createTray()
    }
  })
}

ipcMain.handle('get-settings', () => settings)

ipcMain.handle('set-settings', (_, newSettings) => {
  settings = { ...settings, ...newSettings }
  saveSettings(settings)

  setAutoLaunch(settings.autoLaunch)

  if (settings.closeToTray) {
    createTray()
  } else {
    destroyTray()
  }

  return { needRestart: false }
})

ipcMain.handle('restart-window', () => {
  if (win) {
    const bounds = win.getBounds()
    win.destroy()
    createWindow()
    win.setBounds(bounds)
  }
})

ipcMain.handle('quit-app', () => {
  isQuitting = true
  app.quit()
})

app.whenReady().then(async () => {
  // 开窗前清掉 Service Worker 与其缓存:Electron 允许 file:// 注册 SW,1.34.0 注册的 SW 接管导航后
  // fetch() file:// 失败致白屏,且先于新页面执行,只能由外壳拆。只动这两类存储,localStorage(存档)不碰
  try {
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
  } catch {
    // 清不掉也照常开窗:sw.js 自身还有一道自我注销
  }
  createWindow()

  if (settings.closeToTray) {
    createTray()
  }

  setAutoLaunch(settings.autoLaunch)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (win) {
    win.show()
  } else {
    createWindow()
  }
})
