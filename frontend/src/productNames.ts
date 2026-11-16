export const key = (name: string) => name.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ')
