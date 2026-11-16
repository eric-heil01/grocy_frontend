export type IconName = 'home' | 'groceries' | 'meals' | 'products' | 'plus'

export default function Icon({ name }: { name: IconName }) {
  const paths = {
    home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    groceries: 'M3 3h2l3 12h10l3-9H6 M9 20h.01 M18 20h.01',
    meals: 'M5 3v6m3-6v6M3 6h7M6.5 9v12M17 3v18m0-18c-4 3-4 9 0 9',
    products: 'm3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
    plus: 'M12 5v14M5 12h14',
  }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
