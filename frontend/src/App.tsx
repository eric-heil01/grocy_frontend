import { useEffect, useState } from 'react'
import { formatDay, getDashboard } from './api'
import type { Dashboard, MealDay } from './api'
import './App.css'
import Groceries from './Groceries'
import Meals from './Meals'
import Products from './Products'
import { ProductCreationDialog } from './ProductCreationDialog'
import AppHeader from './AppHeader'
import Icon from './Icon'
import Inventory from './Inventory'

function MealNames({ day }: { day: MealDay }) {
  if (!day.available) return <span className="muted">Dinner information unavailable</span>
  if (!day.planned) return <span className="muted">Nothing planned</span>
  return <>{day.meals.map(meal => <span className="meal-name" key={meal.id}>{meal.name}</span>)}</>
}

function DashboardHome({ active }: { active: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const refresh = () => {
    setLoading(true)
    setError('')
    setAttempt(n => n + 1)
  }
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    getDashboard(controller.signal).then(result => { setData(result); setError('') }).catch(() => {
      if (!controller.signal.aborted) setError('Unable to load your household. Please try again.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt, active])

  return <main tabIndex={-1}>
    <div className="page-toolbar"><span>Your home, made simpler</span><button disabled={loading} onClick={refresh}>Refresh</button></div>
    <div className="intro"><p className="eyebrow">A LITTLE LESS TO THINK ABOUT</p><h1 tabIndex={-1}>Your household, at a glance.</h1><p>Tonight's dinner. The next shop. The week ahead.</p></div>
    {loading && <p role="status" className="message">Loading your household...</p>}
    {error && <div role="alert" className="message error">{error} <button onClick={refresh}>Try again</button></div>}
    <nav className="dashboard-shortcuts" aria-label="Household shortcuts">
      <a className="shortcut" href="#groceries"><Icon name="groceries" /><span><strong>Groceries</strong><small>Make your next shop easier</small></span><span aria-hidden="true">→</span></a>
      <a className="shortcut" href="#meals"><Icon name="meals" /><span><strong>Plan dinner</strong><small>See what’s on the menu</small></span><span aria-hidden="true">→</span></a>
      <a className="shortcut" href="#products"><Icon name="products" /><span><strong>Products</strong><small>The things your household uses</small></span><span aria-hidden="true">→</span></a>
    </nav>
    {!loading && !error && data && <>
      <p className="date">{formatDay(data.today, { weekday: 'long', month: 'long', day: 'numeric' })} <span> / {data.timezone}</span></p>
      {data.notices.length > 0 && <aside className="message" aria-label="Data availability">{data.notices.map(notice => <p key={notice}>{notice}</p>)}</aside>}
      <div className="dashboard">
        <section className="card dinner"><p className="eyebrow">THIS EVENING</p><h2>Dinner tonight</h2><div className="dinner-name">{data.dinner_tonight.available && !data.dinner_tonight.planned ? 'Nothing planned for tonight.' : <MealNames day={data.dinner_tonight} />}</div><a className="button" href="#meals">Plan dinners</a></section>
        <section className="card groceries"><p className="eyebrow">THE NEXT SHOP</p><h2>Grocery list</h2>{data.shopping_list.available ? <><p className="count">{data.shopping_list.remaining_items}<span>items remaining</span></p><p>{data.shopping_list.name} · {data.shopping_list.total_items} total</p></> : <p>Grocery information unavailable.</p>}<a className="button" href="#groceries">View grocery list <span aria-hidden="true">↗</span></a></section>
        <section className="card week"><p className="eyebrow">MAKE ROOM FOR THE WEEK</p><h2>Upcoming dinners</h2><a className="button" href="#meals">Open meal planner</a><p className="muted">Today and the next six days</p><ol className="days">{data.upcoming_meals.map((day, index) => <li key={day.date}><div className="day"><strong>{index === 0 ? 'Today' : formatDay(day.date, { weekday: 'short' })}</strong><time dateTime={day.date}>{formatDay(day.date, { month: 'short', day: 'numeric' })}</time></div><div><MealNames day={day} /></div></li>)}</ol></section>
        <section className="card inventory"><p className="eyebrow">IN THE CUPBOARD</p><h2>Running low</h2>{!data.inventory.available ? <p>Inventory information unavailable.</p> : data.inventory.low_stock.length === 0 ? <p>No products below their minimum stock level.</p> : <ul className="stock">{data.inventory.low_stock.map(item => <li key={item.id}><span>{item.name}</span><span>{item.amount_missing} short</span></li>)}</ul>}<a className="button" href="#inventory">See what you have</a></section>
      </div>
    </>}
    <footer>A simpler rhythm for home.</footer>
  </main>
}

export default function App() {
  const [creating, setCreating] = useState(false)
  const [productRevision, setProductRevision] = useState(0)
  const route = () => ['#groceries', '#meals', '#products', '#inventory'].includes(window.location.hash) ? window.location.hash : '#'
  const [page, setPage] = useState(route)
  const [visited, setVisited] = useState(() => new Set([route()]))
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const titles: Record<string, string> = { '#': 'Home', '#groceries': 'Groceries', '#meals': 'Meals', '#products': 'Products', '#inventory': 'Inventory' }
    document.title = `${titles[page]} | Grocy`
    const onHashChange = () => {
      if (document.querySelector('dialog[open]')) { window.history.replaceState(null, '', page); return }
      const next = route()
      setVisited(previous => new Set([...previous, next])); setPage(next); setNotice('')
      requestAnimationFrame(() => { document.querySelector<HTMLElement>('.screen:not([hidden]) h1')?.focus(); window.scrollTo(0, 0) })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [page])
  return <><AppHeader page={page} onAdd={() => { setNotice(''); setCreating(true) }} />
    <div className={`app-notice${notice ? ' has-notice' : ''}`} role="status">{notice}</div>
    {visited.has('#') && <div className="screen" hidden={page !== '#'}><DashboardHome active={page === '#'} /></div>}
    {visited.has('#groceries') && <div className="screen" hidden={page !== '#groceries'}><Groceries productRevision={productRevision} onProductCreated={() => setProductRevision(n => n + 1)} /></div>}
    {visited.has('#inventory') && <div className="screen" hidden={page !== '#inventory'}><Inventory productRevision={productRevision} onProductCreated={() => setProductRevision(n => n + 1)} /></div>}
    {visited.has('#meals') && <div className="screen" hidden={page !== '#meals'}><Meals /></div>}
    {visited.has('#products') && <div className="screen" hidden={page !== '#products'}><Products revision={productRevision} /></div>}
    {creating && <ProductCreationDialog onCancel={() => setCreating(false)} onChoose={(product, created) => { setProductRevision(n => n + 1); setCreating(false); setNotice(created ? `Product saved: ${product.name}. Ready to use when you need it.` : `${product.name} already exists and is ready to use.`) }} />}
  </>
}
