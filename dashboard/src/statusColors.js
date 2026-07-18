// Semantic status → color theme. Previously the colored dot/badge cycled
// green/cyan/purple/yellow by ROW INDEX, which encoded nothing. Now the color
// means the pipeline state, consistently across every table and card.
//
// Themes reuse the existing CSS classes (green-theme/cyan-theme/yellow-theme/
// purple-theme) plus two added ones (red-theme, grey-theme) so the glass look
// is unchanged — only the mapping is meaningful now.
//
//   green  = live opportunity (Active) / done well (Sold)
//   cyan   = being worked (Claimed, Contacted, Negotiating)
//   purple = committed / in the logistics chain (Purchased, Shipping, Customs)
//   yellow = money on the ground, ready (In Stock)
//   red    = lost
const STATUS_THEME = {
  Active: 'green-theme',
  Claimed: 'cyan-theme',
  Contacted: 'cyan-theme',
  Negotiating: 'cyan-theme',
  Purchased: 'purple-theme',
  Shipping: 'purple-theme',
  Customs: 'purple-theme',
  'In Stock': 'yellow-theme',
  Sold: 'green-theme',
  Lost: 'red-theme',
};

export const statusTheme = (status) => STATUS_THEME[status] || 'grey-theme';
