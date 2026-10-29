import type { Product, SearchResponse } from '../types/product'

export const nutellaProduct: Product = {
  barcode: '0098008952506',
  name: 'Nutella',
  brands: ['Ferrero'],
  image_url: 'https://images.openfoodfacts.org/nutella.jpg',
  ingredients_text: 'sugar, palm oil, _hazelnuts_, skimmed _milk_ powder',
  categories: ['Spreads', 'Hazelnut spreads'],
  countries: ['United Kingdom'],
  labels: ['No gluten'],
  halal_labels: [],
  source_url: 'https://world.openfoodfacts.org/product/0098008952506',
}

export const halalProduct: Product = {
  ...nutellaProduct,
  barcode: '3436598133214',
  name: 'Taboulé au poulet',
  brands: ['Oriental Viandes'],
  labels: ['Halal', 'Contrôle de la mosquée d’Évry'],
  halal_labels: ['Halal', 'Contrôle de la mosquée d’Évry'],
  source_url: 'https://world.openfoodfacts.org/product/3436598133214',
}

export const sparseProduct: Product = {
  barcode: '12345678',
  name: null,
  brands: [],
  image_url: null,
  ingredients_text: null,
  categories: [],
  countries: [],
  labels: [],
  halal_labels: [],
  source_url: 'https://world.openfoodfacts.org/product/12345678',
}

export const nutellaSearch: SearchResponse = {
  query: 'nutella',
  page: 1,
  page_size: 24,
  total: 2,
  products: [
    {
      barcode: nutellaProduct.barcode,
      name: 'Nutella',
      brands: ['Ferrero'],
      image_url: 'https://images.openfoodfacts.org/nutella-small.jpg',
    },
    { barcode: '0009800800049', name: null, brands: [], image_url: null },
  ],
}
