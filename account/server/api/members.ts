const members = [{
  name: 'Anthony Fu',
  uid: 'antfu',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/antfu' }
}, {
  name: 'Baptiste Leproux',
  uid: 'larbish',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/larbish' }
}, {
  name: 'Benjamin Canac',
  uid: 'benjamincanac',
  role: 'owner',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/benjamincanac' }
}, {
  name: 'Céline Dumerc',
  uid: 'celinedumerc',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/celinedumerc' }
}, {
  name: 'Daniel Roe',
  uid: 'danielroe',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/danielroe' }
}, {
  name: 'Farnabaz',
  uid: 'farnabaz',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/farnabaz' }
}, {
  name: 'Ferdinand Coumau',
  uid: 'FerdinandCoumau',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/FerdinandCoumau' }
}, {
  name: 'Hugo Richard',
  uid: 'hugorcd',
  role: 'owner',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/hugorcd' }
}, {
  name: 'Pooya Parsa',
  uid: 'pi0',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/pi0' }
}, {
  name: 'Sarah Moriceau',
  uid: 'SarahM19',
  role: 'member',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/SarahM19' }
}, {
  name: 'Sébastien Chopin',
  uid: 'Atinux',
  role: 'owner',
  avatar: { src: 'https://ipx.nuxt.com/f_auto,s_192x192/gh_avatar/atinux' }
}]

export default eventHandler(async () => {
  return members
})
