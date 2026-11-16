export default function AppHeader({ page, onAdd }: { page: string; onAdd: () => void }) {
  return <header className="app-header">
    <a className="brand" href="#">grocy</a>
    <nav aria-label="Main navigation">
      {[['#', 'Home'], ['#groceries', 'Groceries'], ['#meals', 'Meal planning'], ['#products', 'Products']].map(([href, label]) => <a key={href} href={href} aria-current={(page || '#') === href ? 'page' : undefined}>{label}</a>)}
    </nav>
    <button className="primary" onClick={onAdd}>Add product</button>
  </header>
}
