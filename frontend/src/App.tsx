import { useEffect, useState } from 'react'
import { formatDay, getDashboard } from './api'
import type { Dashboard, MealDay } from './api'
import './App.css'

function MealNames({ day }: { day: MealDay }) {
  if (!day.available) return <span className="muted">Dinner information unavailable</span>
  if (!day.planned) return <span className="muted">Nothing planned</span>
  return <>{day.meals.map(meal => <span className="meal-name" key={meal.id}>{meal.name}</span>)}</>
}

export default function App() {
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
    const controller = new AbortController()
    getDashboard(controller.signal).then(setData).catch(() => {
      if (!controller.signal.aborted) setError('Unable to load your household. Please try again.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])

  return <main>
    <header><a className="brand" href="#">grocy<span> / home</span></a><button disabled={loading} onClick={refresh}>Refresh</button></header>
    <div className="intro"><p className="eyebrow">A LITTLE LESS TO THINK ABOUT</p><h1>Your household, at a glance.</h1><p>Tonight's dinner. The next shop. The week ahead.</p></div>
    {loading && <p role="status" className="message">Loading your household...</p>}
    {error && <div role="alert" className="message error">{error} <button onClick={refresh}>Try again</button></div>}
    {!loading && !error && data && <>
      <p className="date">{formatDay(data.today, { weekday: 'long', month: 'long', day: 'numeric' })} <span> / {data.timezone}</span></p>
      {data.notices.length > 0 && <aside className="message" aria-label="Data availability">{data.notices.map(notice => <p key={notice}>{notice}</p>)}</aside>}
      <div className="dashboard">
        <section className="card dinner"><p className="eyebrow">AT THE TABLE</p><h2>Dinner tonight</h2><div className="dinner-name">{data.dinner_tonight.available && !data.dinner_tonight.planned ? 'Nothing planned for tonight.' : <MealNames day={data.dinner_tonight} />}</div><p>A good evening starts here.</p></section>
        <section className="card groceries"><p className="eyebrow">THE NEXT SHOP</p><h2>Grocery list</h2>{data.shopping_list.available ? <><p className="count">{data.shopping_list.remaining_items}<span>items remaining</span></p><p>{data.shopping_list.name} · {data.shopping_list.total_items} total</p><a className="button" href="#grocery-items">View grocery list <span aria-hidden="true">↗</span></a></> : <p>Grocery information unavailable.</p>}</section>
        <section className="card week"><p className="eyebrow">MAKE ROOM FOR THE WEEK</p><h2>Upcoming dinners</h2><p className="muted">Today and the next six days</p><ol className="days">{data.upcoming_meals.map((day, index) => <li key={day.date}><div className="day"><strong>{index === 0 ? 'Today' : formatDay(day.date, { weekday: 'short' })}</strong><time dateTime={day.date}>{formatDay(day.date, { month: 'short', day: 'numeric' })}</time></div><div><MealNames day={day} /></div></li>)}</ol></section>
        <section className="card inventory"><p className="eyebrow">IN THE CUPBOARD</p><h2>Running low</h2>{!data.inventory.available ? <p>Inventory information unavailable.</p> : data.inventory.low_stock.length === 0 ? <p>No products below their minimum stock level.</p> : <ul className="stock">{data.inventory.low_stock.map(item => <li key={item.id}><span>{item.name}</span><span>{item.amount_missing} short</span></li>)}</ul>}</section>
        <section className="card items" id="grocery-items"><p className="eyebrow">READY WHEN YOU ARE</p><h2>Grocery items</h2><p className="muted">Read-only · Manage your list in Grocy.</p>{!data.shopping_list.available ? <p>Grocery information unavailable.</p> : data.shopping_list.items.length === 0 ? <p className="empty">Your grocery list is empty.</p> : <ul className="shopping-items">{[...data.shopping_list.items].sort((a, b) => Number(a.done) - Number(b.done)).map(item => <li key={item.id} className={item.done ? 'completed' : ''}><span className="item-state" aria-label={item.done ? 'Completed' : 'Outstanding'}>{item.done ? '✓' : '○'}</span><div><span>{item.name}</span>{item.note && item.note !== item.name && <small>{item.note}</small>}{data.shopping_list.id === null && <small>List {item.list_id ?? 'unspecified'}</small>}</div><span>{item.amount ?? '—'}</span></li>)}</ul>}</section>
      </div>
    </>}
    <footer>A simpler rhythm for home.</footer>
  </main>
}
