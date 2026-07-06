export type MatchStrategy = {
  id: string
  label: string
  columns: string[]
  branch: 'zillow' | 'mad' | 'both'
  fuzzy?: boolean
}

export const ZILLOW_STRATEGIES: MatchStrategy[] = [
  {
    id: 'email_company',
    label: 'Email + Company',
    columns: ['Email', 'Company'],
    branch: 'zillow',
  },
  {
    id: 'email',
    label: 'Email',
    columns: ['Email'],
    branch: 'zillow',
  },
  {
    id: 'name_company',
    label: 'Name (fuzzy) + Company',
    columns: ['Name', 'Company'],
    branch: 'zillow',
    fuzzy: true,
  },
  {
    id: 'website',
    label: 'Website',
    columns: ['Website'],
    branch: 'zillow',
  },
  {
    id: 'phone_name_fuzzy',
    label: 'Phone + Name (fuzzy)',
    columns: ['Phone', 'Name'],
    branch: 'zillow',
    fuzzy: true,
  },
  {
    id: 'name_company_state',
    label: 'Name (fuzzy) + Company + State',
    columns: ['Name', 'Company', 'Location'],
    branch: 'zillow',
    fuzzy: true,
  },
  {
    id: 'name_state_fuzzy',
    label: 'Name (fuzzy) + State',
    columns: ['Name', 'Location'],
    branch: 'zillow',
    fuzzy: true,
  },
  {
    id: 'name_state_exact',
    label: 'Name (exact) + State',
    columns: ['Name', 'Location'],
    branch: 'zillow',
    fuzzy: false,
  },
]

export const MAD_STRATEGIES: MatchStrategy[] = [
  {
    id: 'email',
    label: 'Email',
    columns: ['Email'],
    branch: 'mad',
  },
  {
    id: 'phone',
    label: 'Phone',
    columns: ['Phone'],
    branch: 'mad',
  },
  {
    id: 'name_state_exact',
    label: 'Name (exact) + State',
    columns: ['Name', 'Location'],
    branch: 'mad',
    fuzzy: false,
  },
  {
    id: 'name_state_fuzzy',
    label: 'Name (fuzzy) + State',
    columns: ['Name', 'Location'],
    branch: 'mad',
    fuzzy: true,
  },
  {
    id: 'name_exact',
    label: 'Name (exact)',
    columns: ['Name'],
    branch: 'mad',
    fuzzy: false,
  },
  {
    id: 'name_fuzzy',
    label: 'Name (fuzzy)',
    columns: ['Name'],
    branch: 'mad',
    fuzzy: true,
  },
]

export const DEFAULT_ZILLOW_CONFIG: string[] = ZILLOW_STRATEGIES.map(s => s.id)

export const DEFAULT_MAD_CONFIG: string[] = MAD_STRATEGIES.map(s => s.id)
