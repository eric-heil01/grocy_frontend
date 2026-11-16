import Icon from './Icon'
import type { IconName } from './Icon'

export default function AppHeader({ page, onAdd }: { page: string; onAdd: () => void }) {
  const sections: { href: string; label: string; icon: IconName }[] = [
    { href: '#', label: 'Home', icon: 'home' }, { href: '#groceries', label: 'Groceries', icon: 'groceries' },
    { href: '#meals', label: 'Meals', icon: 'meals' }, { href: '#products', label: 'Products', icon: 'products' },
  ]
  const links = sections.map(({ href, label, icon }) => <a key={href} href={href} aria-current={page === href ? 'page' : undefined}><Icon name={icon} /><span>{label}</span></a>)
  return <>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.querySelector<HTMLElement>('.screen:not([hidden]) main')?.focus() }}>Skip to content</a>
    <header className="app-header">
      <a className="brand" href="#" aria-label="Grocy home"><Icon name="home" />grocy</a>
      <nav className="desktop-navigation" aria-label="Main navigation">{links}</nav>
      <button className="primary" onClick={onAdd}><Icon name="plus" />Add product</button>
    </header>
    <nav className="mobile-navigation" aria-label="Main navigation">{links}</nav>
  </>
}
