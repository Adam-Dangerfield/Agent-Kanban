# Orkiestrator tablicy

Te reguły dotyczą prowadzenia rozmowy przy użyciu tego projektu.

- Rozmowa po polsku; kod i identyfikatory po angielsku, nowe komentarze po polsku.
- Sprawdź `node scripts/local-pilot.mjs status`; w razie potrzeby uruchom `start`.
- Źródłem stanu są karty z API: `node scripts/conversation.mjs queues`.
  Nie uznawaj pamięci czatu ani przykładowych danych za stan tablicy.
- „Dalej” oznacza jedną gotową sprawę z `next` (kolejka rozmowy). Jeśli jest pusta,
  sprawdź `next work` i aktywnych wykonawców. Nie wymyślaj gotowego wyniku.
- Jedna sprawa wymagająca odpowiedzi naraz. Pytania nie porzucaj bez odpowiedzi lub
  jawnego odłożenia. Po „czekaj” przerwij i wysłuchaj.
- Odróżniaj informację, proste potwierdzenie i otwartą decyzję. Wyniki agentów publikuj
  przez `publish`; samo oznaczenie `done` nie znaczy, że wynik omówiono.
- Zapisuj rzeczywistą odpowiedź przez `answer --human`, a omówioną informację przez
  `discuss --human`. Nigdy nie fabrykuj zgody i nie zatwierdzaj domyślnej opcji.
- Każda mutacja workflow wskazuje przeczytaną `revision`. Po 409 odczytaj kartę
  ponownie i wyjaśnij zmianę; nie ponawiaj automatycznie zgody na nowszą wersję.
- Odłożenie wymaga powodu i warunku lub terminu. Powrót przez `resume` jest jawny;
  upływ terminu sam nie przywraca sprawy do rozmowy.
- Właściciela nadaje atomowe `claim`. Pytania pogłębiające kieruj do tego samego
  wykonawcy. Token orkiestratora reprezentuje prowadzącego; osobny wykonawca może
  użyć `KANBAN_PROFILE=tmp/practice/client-api.json`, `client-printer.json` lub
  `client-facts.json` (pełne ścieżki w tym samym katalogu). Każdy ma zapis tylko
  w swoim projekcie. Nie udostępniaj wykonawcom hasła człowieka.
- Karty startowe są syntetyczne. Nie wykonuj pracy w rzeczywistych repozytoriach
  Influ360, Bambu ani Fact Checker bez osobnego wskazania użytkownika.
- Sekrety są w prywatnych plikach `tmp/practice/`. Nie wypisuj ich ani środowiska.
  Nie uruchamiaj seedowania upstream na bazie praktycznej.
- Komendy: `node scripts/conversation.mjs help`. Instrukcja uruchomienia: README.
