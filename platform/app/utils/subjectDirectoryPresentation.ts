interface DirectorySubjectNode {
  subjectType: string
  subjectCode: string
  externalRef: string | null
}

export function omitProjectSubjects<T extends DirectorySubjectNode>(subjects: T[]): T[] {
  const projectKeys = new Set(
    subjects
      .filter(subject => subject.subjectType === 'project' && subject.externalRef)
      .map(subject => `${subject.subjectCode}\u0000${subject.externalRef}`)
  )

  return subjects.filter((subject) => {
    if (subject.subjectType === 'project') return false
    if (subject.subjectType !== 'job' || !subject.externalRef) return true
    return !projectKeys.has(`${subject.subjectCode}\u0000${subject.externalRef}`)
  })
}
