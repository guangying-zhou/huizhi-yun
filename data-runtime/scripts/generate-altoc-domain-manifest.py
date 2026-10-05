import re,json,pathlib,sys
s=pathlib.Path('altoc/docs/altoc_schema.sql').read_text()
all={m[1]:m[0] for m in re.finditer(r'^CREATE TABLE(?: IF NOT EXISTS)? `?(\w+)`? \(.*?^\) ENGINE=.*?;',s,re.M|re.S)}
needed=set('customer contact contract receivable_plan contract_line contract_payment_term contract_obligation contract_billing_schedule lead opportunity opportunity_stage quotation quotation_item'.split())
result=[];done=set()
while needed-done:
 previous=len(done)
 for name in sorted(needed-done):
  q=all[name];refs=set(re.findall(r'REFERENCES\s+`?(\w+)',q))
  if not refs<=done:continue
  cols=re.findall(r'^    `?(\w+)`?\s+(?:BIGINT|INT|VARCHAR|CHAR|TEXT|LONGTEXT|MEDIUMTEXT|TINYINT|SMALLINT|DECIMAL|DATETIME|TIMESTAMP|DATE|JSON|ENUM|BOOLEAN|BOOL|DOUBLE|FLOAT|BINARY|VARBINARY)\b',q,re.M|re.I)
  q=re.sub(r'^CREATE TABLE(?: IF NOT EXISTS)? `?'+name+r'`?', 'CREATE TABLE `altoc_'+name+'`',q)
  q=re.sub(r'REFERENCES\s+`?(\w+)`?',lambda m:'REFERENCES `altoc_'+m[1]+'`',q)
  q=re.sub(r'CONSTRAINT\s+(\w+)',lambda m:'CONSTRAINT altoc_'+m[1],q)
  result.append({'Logical':name,'Physical':'altoc_'+name,'Columns':cols,'DDL':q});done.add(name)
 if len(done)==previous: raise RuntimeError('Altoc schema FK dependency cycle or missing dependency')
p=pathlib.Path('data-runtime/internal/enterprise/domaininstall/altoc.json')
content=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
if '--check' in sys.argv:
 if p.read_text()!=content: raise SystemExit('Altoc embedded DDL differs from canonical schema')
 print('Altoc manifest: 13 tables match canonical schema')
else: p.write_text(content)
