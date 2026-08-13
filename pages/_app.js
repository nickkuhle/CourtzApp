// Tailwind is compiled into global.css at build time (tailwind.config.js +
// postcss.config.js). There is deliberately no runtime dependency on
// https://cdn.tailwindcss.com any more, so the app renders correctly with no
// internet access to the CDN.
import '../global.css'
import Head from 'next/head'

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
