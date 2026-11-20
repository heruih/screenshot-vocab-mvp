samples = ["airＧconditioning", "cliché", "résumé", "o\U001001b3clock", "fulfil(", "l)ous", "instal(l)ation", "２/cheque"]
for s in samples:
    print(repr(s), "->", [hex(ord(c)) for c in s if ord(c) > 127])
