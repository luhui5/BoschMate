import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { AppProvider } from '@/components/app-provider'
import { TitleBar } from '@/components/title-bar'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'YourMate — 本地 AI 助手',
  description: '本地运行、安全可控的 AI 编码助手，具备长期记忆、自动化代码修改、Git 集成与计划生成能力。',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/bosch-icon-black.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/bosch-icon-white.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: '/bosch-icon-white.svg',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh"
      className={`dark ${geistSans.variable} ${geistMono.variable} bg-background`}
    >
      <body className="font-sans antialiased" style={{ paddingTop: 34 }}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=location.pathname,m=p.match(/^\\/project\\/([^/]+)\\/?$/);if(m&&m[1]&&m[1]!=='index.html'&&m[1]!=='placeholder'){location.replace('/?project='+encodeURIComponent(m[1]));return}if(p.startsWith('/project')){var id=new URLSearchParams(location.search).get('id');if(id)location.replace('/?project='+encodeURIComponent(id))}}catch(e){}})();`,
          }}
        />
        <AppProvider>
          <TitleBar />
          {children}
        </AppProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
