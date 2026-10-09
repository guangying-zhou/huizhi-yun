type PeopleHRSourceActor = {
  appCode?: unknown
  actorId?: unknown
}

export function isCanonicalPeopleHRSourceClient(actor: PeopleHRSourceActor) {
  const app = String(actor.appCode || '').trim().toLowerCase()
  const client = String(actor.actorId || '').trim()
  return (app === 'people' && client === 'people.runtime')
    || (app === 'enterprise' && client === 'enterprise.runtime')
}
