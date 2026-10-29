# The math behind switch

## TL;DR

A run of switch is a state machine. From an initial state, the question function gives the questions of the latest
state, the model answers each one with probabilities from a softmax over its scores, and the transition function gives
the next state from the answers. The run ends when the question function gives no questions. A pick is the case of one
choice question over the choices of a state. The trace keeps every state, so a replay needs nothing else and gives the
recorded run exactly. The view function gets a budget, a fixed share of the model's window less the questions, and when
the model's API says that a request was still too long, switch asks for a view smaller by a fixed factor.

## What this covers

switch is a framework for harnesses around decision models. A decision model reads some JSON, answers typed
questions with probabilities, and writes no text. This doc writes down the math of a run in symbols, with no domain in
mind: the state machine, the answers and their probabilities, the pick, a whole run, the replay, and how a request is
fit into the model's window. Where an example helps, it uses chess.

## A run as a state machine

A case is a state machine with three parts that the domain gives:

- an **initial state** $S_0$;
- a **question function** $Q$, which takes a state and gives the questions that the model must answer in it,
  $Q(S) = (q_1, \dots, q_k)$, each under an id;
- a **transition function** $T$, which takes a state and the answers to its questions and gives the next state.

Between the question function and the transition function sits the decision model, which answers every question.
After $t$ steps the state is $S_t$, and step $t$ goes from $S_{t-1}$ to $S_t$:

$$a_t = (a_{t,1}, \dots, a_{t,k}) \text{ answers } Q(S_{t-1}), \qquad S_t = T(S_{t-1}, a_t)$$

The run ends at the first state $S_N$ with $Q(S_N) = \varnothing$, and its result is $S_N$. A state is JSON that the
domain designs: everything that the question function, the transition function and the view function need to know
about where the case is. The answers of a step reach the next step only through the state, since $T$ writes into
$S_t$ what $Q$ needs to read. The case's data that never changes is no part of the state. It stays inside the
functions.

In chess, a state holds the start position, the moves played so far, the position that they lead to, and whether the
game is over. While the game is on, $Q$ asks one question, which of the legal moves to play, and $T$ plays the answer
and the opponent's reply. Once the game is over, $Q$ asks nothing.

The textbook model for this is a Markov decision process. Its names map to switch's names as follows:

| Textbook name                 | switch name                                          |
| ----------------------------- | ---------------------------------------------------- |
| state $s$                     | state $S$                                            |
| set of allowed actions $A(s)$ | the answers that $Q(S)$ allows                       |
| transition                    | transition function $T(S, a)$                        |
| policy $\pi(a \mid s)$        | the model's probabilities over the answers of $Q(S)$ |
| terminal state                | a state $S$ with $Q(S) = \varnothing$                |

$T$ may give a different next state for the same state and answers, for example when a chess engine replies. switch
does not need $T$ to be repeatable, because the trace keeps every state that $T$ gave.

## The view function

The model does not read the state itself. It reads the **view**, which a fourth function of the domain, the **view
function** $V$, makes from the state. $V$ takes the state, a budget of $\tau$ estimated tokens, and $r$, the characters
per token at which switch estimates sizes. It gives a JSON object $J$ and a list of images $I$, which are all that the
model reads besides the questions:

$$V(S, \tau, r) = (J, I)$$

A domain that gives no view function lets the model read the state as it is, with no images:

$$V(S, \tau, r) = (S, \varnothing)$$

The state says which step the case is in, so a view can differ between steps that ask different questions. In chess,
the view function draws the board as text, lists each side's pieces, and gives the moves so far, or only the latest
ones when the whole game does not fit $\tau$.

## Answers and their probabilities

The model never writes an answer as text. Each question allows a fixed set of answers under short labels, and the
model gives a score $\ell_i$ for each label, the raw number before any normalizing. A softmax turns the scores into
probabilities that add up to 1:

$$p_i = \frac{e^{\ell_i / \theta}}{\sum_{j=1}^{n} e^{\ell_j / \theta}}$$

Here $n$ is the number of labels, and $\theta$ is the model's temperature, which its makers fit and switch does not
set. A value above 1 flattens the probabilities, and a value below 1 sharpens them. What an answer is depends on the
type of its question:

- A **bool** question has the labels true and false, and its answer is $P(\text{true}) = p_{\text{true}}$.
- A **choice** question has one label per allowed answer, and its answer is the likeliest label, with the
  probability of every label:

$$i^* = \arg\max_i \, p_i$$

- A **score** question has levels $0, 1, \dots, k-1$. Its answer is the expected level:

$$\text{score} = \sum_{i=0}^{k-1} i \, p_i$$

Nothing here is drawn at random: the model's scores alone decide every answer. A choice answer also has a
**confidence**, which rescales the top probability $p_{\max} = p_{i^*}$ to the number of labels:

$$\text{conf} = \min\!\left(1,\; \max\!\left(0,\; \frac{n\,p_{\max} - 1}{n - 1}\right)\right)$$

It is 0 when every label is equally likely, $p_{\max} = 1/n$, and 1 when one label has all the probability. Between
those, it grows in a straight line with $p_{\max}$. The rescaling lets questions with different numbers of labels be
compared: a top probability of 0.5 gives a confidence of 0 among 2 labels and $14/29 \approx 0.48$ among 30.

A score's confidence looks at distance, because the levels are in order. With $m$ the likeliest level, it compares
the expected distance from $m$ with that of an even spread from the middle of the scale:

$$\text{conf} = \max\!\left(0,\; 1 - \frac{\sum_i p_i \, |i - m|}{\sum_i \frac{1}{k} \left|i - \frac{k-1}{2}\right|}\right)$$

This is the formula of the decision model APIs that publish one. An API that has no formula of its own for scores,
such as a chat model used as a classifier, may give the choice's confidence instead. These answers and their formulas
belong to the decision-model API, and switch takes them as the API gives them.

## The pick

The most common question is a **pick**: one choice question whose allowed answers are the **choices** of a state, such
as the legal moves of a chess position. A domain gives a **choice function** $C$, with
$C(S) = (c_1, \dots, c_m)$, and switch's pick helper builds the question from it in three moves. Let $L$ be the most
choices that one pick may show.

First, every key and every text in $C(S)$ must differ. Two equal texts would give the model two labels that it cannot
tell apart. When they are not all different, the helper stops the run with an error.

Second, the helper keeps at most $L$ choices. Each choice $c_i$ has a priority $\rho_i$, 0 by default, and its place
$i$ in the list. The helper sorts the choices by the pair $(\rho_i, i)$, keeps the first $L$, and shows them in the
order that the choice function gave them. A lower priority value thus keeps a choice, and the earlier choice wins a
tie. The question records how many choices were cut.

Third, the helper gives the kept choices the labels $o_1, o_2, \dots$, so the pick question of a state is

$$O(S) = \text{the kept choices of } C(S), \text{ under the labels } o_1, \dots, o_{|O(S)|}$$

When $C(S)$ is empty, there is no pick, and a machine that only picks asks nothing, so its run ends. The transition
of a pick maps the answer's label back to its choice $c^*$ and runs the domain's transition of that choice:

$$S_t = T_C(S_{t-1}, c^*)$$

switch adds no choice of its own. A domain that wants a way to stop gives it among its choices, with a low $\rho$ so
that the cut keeps it, and its transition gives a state that asks nothing. switch also does not know which answers of
earlier steps were picks, so it cannot refuse a choice that was picked before. The state says what is done, and the
choice function must leave such a choice out. In chess, resigning is one of the choices, and a position has few enough
legal moves that $L$ can be set so that no move is ever cut.

## A whole run

With $L_{\text{steps}}$ the most steps that a run may take, which is none unless the domain sets it, a run goes:

1. Start with $S_0$.
2. For $t = 1, 2, \dots$: if $Q(S_{t-1}) = \varnothing$, end as done after $t - 1$ steps.
3. If $t > L_{\text{steps}}$, end at the step limit after $t - 1$ steps.
4. Ask the model the questions $Q(S_{t-1})$ over the view $V(S_{t-1}, \tau, r)$. The model gives the answers $a_t$,
   each with its probabilities. If a request fails, or its answers do not fit the questions, end as failed.
5. $S_t = T(S_{t-1}, a_t)$.

A run thus ends when the domain has nothing more to ask, and the step limit only guards against a run that never
does. A domain that must ask something last, before a limit of its own, counts its steps in its state.

The trace keeps the probabilities of every answer of every step. From it follows one number that switch does not
compute but any tool can: the probability that a model which drew each answer at random from its probabilities would
take this exact path, with the product over every bool and choice answer of the run:

$$P(\text{path}) = \prod_{t} \prod_{j} p_{t,j}(a_{t,j})$$

A long run of confident answers keeps this high, and one unsure answer lowers it by its whole factor.

## Why a replay is exact

The trace keeps every state $S_0, S_1, \dots, S_N$, the questions and answers of every step and how the run ended,
and it starts with the domain, the case and the limits. A replay walks the same steps of the same domain and case
under the recorded limits:

- At step $t$ it asks $Q$ for the questions of the recorded $S_{t-1}$, checks that the recorded $a_t$ fits them, and
  repeats $a_t$ with its recorded probabilities.
- It takes the recorded $S_t$ and runs no transition.
- It ends where the recorded run ended, also at a failed request.

So a replay calls no model and runs no $T$, and it gives the recorded run even when $T$ would give another state now.
In chess, that is the engine's reply, which need not be the same move twice. The check of $a_t$ against $Q(S_{t-1})$
is what a replay tests: whether the domain's code still asks the questions that the run answered. The answers fit when
they have the same ids and the same types, and when each choice answer still names an allowed answer. For a pick, the
recorded choice is found by its key among the choices of $O(S_{t-1})$, so its label and text may have changed. For any
other choice question, its label must still have the recorded text. A replay fails when the answers do not fit, when
$Q(S_{t-1})$ is empty where the run asked, or when it asks where the run had ended.

A **fork** at step $n$ is the variant that takes $S_n$ from the trace. From step $n + 1$ the model answers and $T$
runs again. It needs the first $n$ answers and the states after them, so it cannot fork at a step whose request
failed. A fork at the step before a domain's last questions asks only those again, so new answers are a function of
that state, the questions and the model.

## Fitting a request into the window

A model reads at most $w$ tokens per request, its window. switch gives the view function a budget before it sends a
request, with these values:

- $\sigma$, the share of the window that a request may fill.
- $r$, the characters per token of the size estimate, set low so that it overestimates.
- $\hat{t}(x) = \lceil |\text{JSON}(x)| / r \rceil$, the estimated tokens of a value $x$.

The questions of a step can be many, so switch first splits them into batches, and each batch goes to the model with
a view of the same state. Each batch may
take $\lfloor q \, w \sigma \rfloor$ tokens of questions, with $q < 1$, which leaves room for the view. switch fills the
batches in order: a question goes into the current batch if it fits, and otherwise it starts a new one. A question
larger than the room gets a batch of its own. The answers of all the batches together are the answers of the step.

The budget of a request is $B = \lfloor w \sigma \rfloor$ tokens. The questions of its batch come first, and the view
gets the rest:

$$\tau_1 = B - \hat{t}(\text{batch})$$

The view function gets $\tau$ and $r$, and must make a view that fits. switch does not cut a view itself: a domain
without a view function sends its state as it is, and images do not count in $\hat{t}$. When the model's API says that
the request was still too long, switch asks the view function again for a smaller view, up to $A$ requests in all,
each time by a factor $\lambda < 1$:

$$\tau_{a+1} = \lfloor \lambda \, \tau_a \rfloor$$

So the $a$-th request gives the view about $\lambda^{a-1} \tau_1$ tokens. A domain without a view function sends each
request once, since its view cannot get smaller.
