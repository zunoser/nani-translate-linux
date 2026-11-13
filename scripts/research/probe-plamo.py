#!/usr/bin/env python3
"""Small capability probes, not a benchmark. Only sends synthetic text to localhost."""
import argparse,json,time,urllib.request
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--url',default='http://127.0.0.1:18765')
p.add_argument('--output',required=True)
a=p.parse_args()
cases=[
 {'id':'en-ja','kind':'translation','source':'The meeting has been moved to next Monday. Please send the revised document by Friday.','target':'ja'},
 {'id':'ja-en','kind':'translation','source':'この変更は既存の設定を保持します。再起動する前に、保存されていないファイルを確認してください。','target':'en'},
 {'id':'polite','kind':'translation','source':'This feature is useful. You can change the settings later.','target':'ja','form':'polite'},
 {'id':'plain','kind':'translation','source':'This feature is useful. You can change the settings later.','target':'ja','form':'plain'},
 {'id':'context','kind':'translation','source':'The bank was muddy.','target':'ja','context':'They were walking beside a river after heavy rain.'},
 {'id':'glossary','kind':'translation','source':'管理画面でオーナーを変更してください。','target':'en','glossary':[{'source':'管理画面','target':'dashboard'},{'source':'オーナー','target':'assignee'}]},
 {'id':'back-translation','kind':'translation','source':'Please change the assignee in the dashboard.','target':'ja'},
 {'id':'reply-source','kind':'translation','source':'ご連絡ありがとうございます。水曜日の午後なら対応できます。','target':'en','context':'A customer asked when we can meet.'},
 {'id':'follow-up-probe','kind':'instruction-probe','source':'Make it more casual and explain what you changed.','target':'ja','history':[{'role':'user','content':'Thank you for your assistance.'},{'role':'assistant','content':'ご協力いただきありがとうございます。'}]},
 {'id':'summary-probe','kind':'instruction-probe','source':'The release was scheduled for Monday. Testing found a serious bug on Sunday. The team postponed the release until Wednesday. They notified all customers by email.','target':'ja','context':'次の文章を日本語の一文に要約してください。全文の翻訳は不要です。'},
 {'id':'proofread-probe','kind':'instruction-probe','source':'He go to school yesterday.','target':'en','context':'Correct the English grammar. Return only the corrected English sentence.'},
 {'id':'explanation-probe','kind':'instruction-probe','source':'What is the difference between "say" and "tell"? Explain in Japanese with two examples.','target':'ja','context':'Answer the question rather than translating it.'},
 {'id':'nani-tags-probe','kind':'instruction-probe','source':'The meeting starts at nine.','target':'ja','context':'Return the translation inside <t><result lang="ja">...</result></t> tags, followed by a <note> explaining the grammar.'},
]
results=[]
for c in cases:
 kwargs={k:c[k] for k in ['form','context','glossary'] if k in c}
 kwargs['target_lang']=c['target']
 body={'model':'plamo-3-translate','messages':c.get('history',[])+[{'role':'user','content':c['source']}], 'temperature':0,'max_tokens':256,'stop':['<|plamo:tag|>','<|plamo:bos|>'],'chat_template_kwargs':kwargs}
 started=time.monotonic()
 req=urllib.request.Request(a.url+'/v1/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=120) as response:data=json.load(response)
  result={**c,'output':data['choices'][0]['message']['content'],'finish_reason':data['choices'][0].get('finish_reason'),'seconds':round(time.monotonic()-started,3),'usage':data.get('usage'),'timings':data.get('timings')}
 except Exception as e:result={**c,'error':str(e),'seconds':round(time.monotonic()-started,3)}
 results.append(result)
 Path(a.output).write_text(json.dumps({'model':'pfnet/plamo-3-translate-0.8b-GGUF:Q4_K_M','revision':'1cf96ae02133958a20074bfdfab76517bb737d00','runtime':'llama.cpp 0.7.0 build 11669; CPU 6 threads; context 4096','scope':'Synthetic capability probes; no reference-model scoring; not Nani UI end-to-end','results':results},ensure_ascii=False,indent=2)+'\n')
 print(c['id'],json.dumps(result,ensure_ascii=False),flush=True)
