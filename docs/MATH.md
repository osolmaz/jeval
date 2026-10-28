# The math behind switch

## TL;DR

A run of switch is a state machine. From an initial state, the choice function gives the choices in the latest state,
the model picks one with probabilities from a softmax over its scores, and the transition function gives the next
state. The trace keeps every state, so a replay needs nothing else and gives the recorded run exactly. The view
function gets a budget, a fixed share of the model's window less the questions, and when the model's API says that a
request was still too long, switch asks for a view smaller by a fixed factor.

## What this covers

switch is a framework for harnesses around decision models. A decision model reads some JSON, answers typed
questions with probabilities, and writes no text. This doc writes down the math of a run in symbols, with no domain in
mind: the state machine, what switch does to the choices, one pick, a whole run, the replay, and how a request is fit
into the model's window. Where an example helps, it uses chess.

## A run as a state machine

A case is a state machine with three parts that the domain gives:

- an **initial state** $S_0$;
- a **choice function** $C$, which takes a state and gives the choices in it, $C(S) = (c_1, \dots, c_m)$;
- a **transition function** $T$, which takes a state and a picked choice and gives the next state.

Between the choice function and the transition sits the decision model, which picks one choice. After $t$ steps the
state is $S_t$, and one step goes from $S_{t-1}$ to $S_t$:

$$c_t \in C(S_{t-1}) \cup \{\text{stop}\}, \qquad S_t = T(S_{t-1}, c_t)$$

The model picks $c_t$, and when it picks stop, the run ends at $S_{t-1}$. A state is JSON that the domain designs:
everything that the choice function, the transition function and the view function need to know about where the case is. The
case's data that never changes is no part of the state. It stays inside the functions.

In chess, a state holds the start position, the moves played so far, and the position that they lead to. $C$ gives
the legal moves of that position, and $T$ plays the picked move and the opponent's reply.

The textbook model for this is a Markov decision process. Its names map to switch's names as follows:

| Textbook name                 | switch name                                       |
| ----------------------------- | ------------------------------------------------- |
| state $s$                     | state $S$                                         |
| set of allowed actions $A(s)$ | choice function $C(S)$                            |
| transition                    | transition function $T(S, c)$                     |
| policy $\pi(a \mid s)$        | the model's probabilities over the choices of $S$ |
| terminal action               | stop                                              |

$T$ may give a different next state for the same state and choice, for example when a chess engine replies. switch
does not need $T$ to be repeatable, because the trace keeps every state that $T$ gave.

## The view function

The model does not read the state itself. It reads the **view**, which a fourth function of the domain, the **view
function** $V$, makes from the state. $V$ takes the state, the purpose $p$ of the request, which is a pick or the
answers at the end, a budget of $\tau$ estimated tokens, and $r$, the characters per token at which switch estimates
sizes. It gives a JSON object $J$ and a list of images $I$, which are all that the model reads besides the questions:

$$V(S, p, \tau, r) = (J, I)$$

A domain that gives no view function lets the model read the state as it is, with no images:

$$V(S, p, \tau, r) = (S, \varnothing)$$

An answer stage of the domain may give a view function of its own for its questions. In chess, the view function
draws the board as text, lists each side's pieces, and gives the moves so far, or only the latest ones when the whole
game does not fit $\tau$.

## What switch does to the choices

Before the model sees the choices of a state, switch checks them and cuts them. Let $K_t$ be the keys of the choices
that the model picked before step $t$, and $L$ the most choices that one step may show, stop included.

First, every key and every text in $C(S_{t-1})$ must differ, no key may be in $K_t$, and no choice may have the key or
the text of stop. Two equal texts would give the model two labels that it cannot tell apart, and a key in $K_t$ would
let the model pick the same thing twice. The state says what is done, so the choice function must leave such a choice
out. When it does not, switch stops the run with an error. In chess, a move's key holds the number of moves played
before it, so the same move in a later position is a new choice.

Second, switch keeps at most $L - 1$ choices, so $L$ is at least 2: stop and one more. Each choice $c_i$ has a
priority $\rho_i$, 0 by default, and its place $i$ in the list. switch sorts the choices by the pair $(\rho_i, i)$,
keeps the first $L - 1$, and shows them in the order that the choice function gave them. A lower priority value thus
keeps a choice, and the earlier choice wins a tie. The trace records how many choices were cut.

Third, switch adds stop, so the model sees at most $L$ choices:

$$O_t = \text{the kept choices of } C(S_{t-1}) \;\cup\; \{\text{stop}\}$$

Chess sets $L$ so that no move is ever cut: a chess position has at most 218 legal moves.

## One pick

The model never writes its pick as text. switch gives each choice of $O_t$ a short label, except stop, which keeps its
own, and asks one choice question whose answers are those labels. The model gives a score $\ell_i$ for each label, the raw number before any
normalizing, and a softmax turns the scores into probabilities that add up to 1:

$$p_i = \frac{e^{\ell_i / \theta}}{\sum_{j=1}^{n} e^{\ell_j / \theta}}$$

Here $n = |O_t|$, and $\theta$ is the model's temperature, which its makers fit and switch does not set. A value above
1 flattens the probabilities, and a value below 1 sharpens them. switch maps each label back to its choice, so the
trace keeps the choices' own keys.

The pick is the likeliest label:

$$i^* = \arg\max_i \, p_i$$

Nothing here is drawn at random: the model's scores alone decide the pick. The answer also has a **confidence**, which
rescales the top probability $p_{\max} = p_{i^*}$ to the number of choices:

$$\text{conf} = \min\!\left(1,\; \max\!\left(0,\; \frac{n\,p_{\max} - 1}{n - 1}\right)\right)$$

It is 0 when every label is equally likely, $p_{\max} = 1/n$, and 1 when one label has all the probability. Between
those, it grows in a straight line with $p_{\max}$. The rescaling lets steps with different numbers of choices be
compared: a top probability of 0.5 gives a confidence of 0 among 2 choices and $14/29 \approx 0.48$ among 30.

The questions at the end of a run use the same probabilities:

- A **bool** question has the answers true and false, and its answer is $P(\text{true}) = p_{\text{true}}$.
- A **choice** question is answered like a pick.
- A **score** question has levels $0, 1, \dots, k-1$. Its answer is the expected level:

$$\text{score} = \sum_{i=0}^{k-1} i \, p_i$$

A score's confidence looks at distance, because the levels are in order. With $m$ the likeliest level, it compares
the expected distance from $m$ with that of an even spread from the middle of the scale:

$$\text{conf} = \max\!\left(0,\; 1 - \frac{\sum_i p_i \, |i - m|}{\sum_i \frac{1}{k} \left|i - \frac{k-1}{2}\right|}\right)$$

This is the formula of the decision model APIs that publish one. An API that has no formula of its own for scores,
such as a chat model used as a classifier, may give the choice's confidence instead.

## A whole run

With $L_{\text{steps}}$ the most steps that a run may take, a run goes:

1. Start with $S_0$.
2. For $t = 1, 2, \dots$: make $O_t$ from $C(S_{t-1})$ by the rules above. If $C(S_{t-1})$ has no choice, end with
   no choices.
3. Ask the model to pick from $O_t$ over the view $V(S_{t-1}, \text{pick}, \tau, r)$. The model gives the
   probabilities $p_t$ and the pick $c_t$.
4. If $c_t$ is stop, end with stop. Otherwise $S_t = T(S_{t-1}, c_t)$.
5. After $L_{\text{steps}}$ picks, end with the step limit. If a request fails, or the model's answer names no label,
   end with a failed pick.
6. Ask the domain's questions over the view $V(S_N, \text{answer}, \tau, r)$ of the last state, $S_N$, where $N$ is
   the number of transitions that ran. The trace records why the steps ended before the answers, and ends with the
   answers, or why they failed.

A run thus takes at most $L_{\text{steps}}$ steps, and never more than the number of different keys that the choice
function can give.

The trace keeps $p_t$ for every choice of every step. From it follows one number that switch does not compute but any
tool can: the probability that a model which drew each pick at random from $p_t$ would take this exact path, with the
product over every pick of the run, stop included:

$$P(\text{path}) = \prod_{t} p_t(c_t)$$

A long run of confident picks keeps this high, and one unsure step lowers it by its whole factor.

## Why a replay is exact

The trace keeps every state $S_0, S_1, \dots, S_N$, every pick and how the steps ended, and it starts with the domain,
the case and the limits. A replay walks the same steps of the same domain and case under the recorded limits:

- At step $t$ it makes $O_t$ from the recorded $S_{t-1}$, finds the recorded $c_t$ among the choices by its key, and
  repeats it with its recorded probabilities.
- It takes the recorded $S_t$ and runs no transition.
- It ends where the recorded steps ended, also at a failed pick.
- At the end it repeats the recorded answers, or their failure.

So a replay calls no model and runs no $T$, and it gives the recorded run even when $T$ would give another state now.
In chess, that is the engine's reply, which need not be the same move twice. The check of $c_t$ against $C(S_{t-1})$
is what a replay tests: whether the domain's code still gives the choices that the run saw. A replay fails when it does
not: when $c_t$ is not among them, when $C(S_{t-1})$ is empty where the run picked, or when it has choices where the
run's steps ended.

Two variants follow from the same trace:

- A **fork** at step $n$ takes $S_n$ from the trace. From step $n + 1$ the model picks and $T$ runs again. It needs
  the first $n$ picks and the states after them, so it cannot fork at a step whose pick failed.
- Asking the questions again repeats every step and its ending, and takes $S_N$ from the trace, so new answers are a
  function of $S_N$, the questions and the model. It needs only the steps of the trace to have ended.

## Fitting a request into the window

A model reads at most $w$ tokens per request, its window. switch gives the view function a budget before it sends a
request, with these values:

- $\sigma$, the share of the window that a request may fill.
- $r$, the characters per token of the size estimate, set low so that it overestimates.
- $\hat{t}(x) = \lceil |\text{JSON}(x)| / r \rceil$, the estimated tokens of a value $x$.

The budget of a request is $B = \lfloor w \sigma \rfloor$ tokens. The questions come first, and the view gets the
rest:

$$\tau_1 = B - \hat{t}(\text{questions})$$

The view function gets $\tau$ and $r$, and must make a view that fits. switch does not cut a view itself: a domain
without a view function sends its state as it is, and images do not count in $\hat{t}$. When the model's API says that
the request was still too long, switch asks the view function again for a smaller view, up to $A$ requests in all,
each time by a factor $\lambda < 1$:

$$\tau_{a+1} = \lfloor \lambda \, \tau_a \rfloor$$

So the $a$-th request gives the view about $\lambda^{a-1} \tau_1$ tokens. A domain without a view function sends each
request once, since its view cannot get smaller.

The questions at the end of a run can be many, so switch splits them into batches. Each batch may take
$\lfloor q \, w \sigma \rfloor$ tokens of questions, with $q < 1$, which leaves room for the view. switch fills the
batches in order: a question goes into the current batch if it fits, and otherwise it starts a new one. A question
larger than the room gets a batch of its own.
