'use client'

import { useEffect, useState } from 'react'

/**
 * `true` when the document is visible (foreground tab). Lets polling
 * hooks pause RPC traffic when the user isn't looking — Solana public
 * RPCs rate-limit aggressively, and a backgrounded tab still draining
 * quota is the kind of thing that gets a deployment blocked.
 *
 * SSR-safe: returns `true` during the server render so initial state
 * doesn't differ between the server and client trees.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return visible
}
