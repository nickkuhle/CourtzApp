import '../global.css'
import Head from 'next/head'

// Tailwind is compiled into global.css at build time via PostCSS. The old
// https://cdn.tailwindcss.com <Script> has been removed: the app must render
// fully styled with no internet access to the Tailwind CDN.
export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
