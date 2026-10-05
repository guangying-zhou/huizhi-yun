type PeopleHRSourceActor = {
  appCode?: unknown
  actorId?: unknown
}

export function isCanonicalPeopleHRSourceClient(actor: PeopleHRSourceActor) {
  return String(actor.appCode || '').trim().toLowerCase() === 'people'
    && String(actor.actorId || '').trim() === 'people.runtime'
}
