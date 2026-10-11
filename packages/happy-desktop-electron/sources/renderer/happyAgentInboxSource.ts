import {
    happyAgentSyncRead,
    type BotGroup,
    type BotSubtaskGroup,
    type GroupSession,
    type HappyAgentClient,
    type HappyAgentConnection,
    type HappyAgentInboxSource,
    type HappyAgentInboxSourceItem,
    type HappyAgentProjectId,
    type HappyAgentSessionScope,
    type HappyAgentWorktreeId,
    type ProjectGroup,
    type TaskGroup,
    type happyAgentProtocol,
} from "happy-desktop-state";

type Question = happyAgentProtocol.Question;

/**
 * Builds the inbox's question feed from what Happy Agent already states.
 *
 * The daemon has no list of questions. Each agent names the one it is waiting
 * on as `pendingQuestionId`, which the connection's catalog already follows,
 * and each named question is read once by id. Which questions are pending is
 * therefore the catalog's call; `question.updated` only adds how a question
 * ended, so one answered while this window watched — here or in its own chat —
 * moves to the answered list. A canceled one, or one resolved while the stream
 * was down, simply leaves: answered questions are not readable afterwards, so
 * the answered list only holds what this window saw resolve.
 */
export function happyAgentInboxSourceCreate(
    client: Pick<HappyAgentClient, "getPendingQuestion">,
    connection: Pick<HappyAgentConnection, "connectGroups" | "sync">,
): HappyAgentInboxSource {
    return {
        subscribe(listener, onError) {
            const controller = new AbortController();
            /** Every session the catalog lists now, by id. */
            let sessions = new Map<string, GroupSession>();
            /** Every question read or announced while subscribed, by id. */
            const questions = new Map<string, Question>();
            /** Where each question's session was last listed, kept for its answered row. */
            const askers = new Map<string, GroupSession>();
            const reading = new Set<string>();
            let catalogLoaded = false;
            /**
             * What was last delivered. The catalog changes with every draft and
             * status, and the window root follows this feed, so an unchanged
             * queue is not delivered again.
             */
            let delivered: string | undefined;

            const publish = (): void => {
                if (controller.signal.aborted || !catalogLoaded) return;
                const items: HappyAgentInboxSourceItem[] = [];
                for (const question of questions.values()) {
                    const asker = sessions.get(question.agentId);
                    if (asker) askers.set(question.id, asker);
                    // An answer is final, so it wins over a catalog that has
                    // not caught up with it yet.
                    if (question.status === "answered") {
                        items.push(itemProject(question, askers.get(question.id)));
                        continue;
                    }
                    if (question.status === "pending" && asker?.pendingQuestionId === question.id)
                        items.push(itemProject(question, asker));
                }
                const key = JSON.stringify(
                    items.map((item) => [item.id, item.status, item.sessionTitle, item.scope]),
                );
                if (key === delivered) return;
                delivered = key;
                listener(items);
            };

            const questionRead = (agentId: string, questionId: string): void => {
                if (reading.has(questionId)) return;
                reading.add(questionId);
                void happyAgentSyncRead(
                    controller.signal,
                    () => client.getPendingQuestion(agentId, { signal: controller.signal }),
                    onError,
                )
                    .then(({ question }) => {
                        // Gone by the time it was read: the catalog has already
                        // stopped naming it, or will.
                        if (question === null || questions.has(question.id)) return;
                        questions.set(question.id, question);
                        publish();
                    })
                    .catch(() => undefined)
                    .finally(() => reading.delete(questionId));
            };

            const groups = connection.connectGroups({
                onChange(projects, state, bots, tasks) {
                    if (!state.sessionsComplete) return;
                    catalogLoaded = true;
                    sessions = sessionsCollect(projects, bots, tasks);
                    for (const session of sessions.values()) {
                        const questionId = session.pendingQuestionId;
                        if (questionId !== undefined && !questions.has(questionId))
                            questionRead(session.id, questionId);
                    }
                    publish();
                },
                onError,
            });

            void (async () => {
                for await (const input of connection.sync.follow({
                    signal: controller.signal,
                    events: ["question.created", "question.updated"],
                })) {
                    if (input.kind !== "update" || input.update.kind !== "event") continue;
                    const event = input.update.event;
                    if (event.type === "question.created") {
                        const question = event.payload.question;
                        if (questions.has(question.id)) continue;
                        questions.set(question.id, question);
                        publish();
                    } else if (event.type === "question.updated") {
                        // A question resolves exactly once, so the first update
                        // naming a pending one is how it ended.
                        const question = questions.get(event.payload.questionId);
                        if (question?.status !== "pending") continue;
                        questions.set(question.id, {
                            ...question,
                            ...event.payload.changes,
                            version: event.payload.version,
                        });
                        publish();
                    }
                }
            })().catch(() => undefined);

            return () => {
                controller.abort();
                groups.close();
            };
        },
    };
}

function itemProject(
    question: Question,
    asker: GroupSession | undefined,
): HappyAgentInboxSourceItem {
    const scope = asker ? scopeProject(asker.scope) : undefined;
    return {
        id: `${question.agentId}/${question.id}`,
        sessionId: question.agentId,
        requestId: question.id,
        ...(scope === undefined ? {} : { scope }),
        ...(asker?.title === undefined ? {} : { sessionTitle: asker.title }),
        questions: question.questions.map((prompt) => ({
            id: prompt.id,
            header: prompt.header,
            question: prompt.question,
            multiSelect: prompt.multiSelect,
            // The daemon refuses an answer that leaves any prompt empty.
            required: true,
            options: prompt.options,
        })),
        status: question.status === "answered" ? "answered" : "pending",
        ...(question.answers === null ? {} : { answers: question.answers }),
        createdAt: question.createdAt,
        ...(question.answeredAt === null ? {} : { resolvedAt: question.answeredAt }),
    };
}

/** A bot's conversation has no project to name, so its question carries no scope. */
function scopeProject(scope: GroupSession["scope"]): HappyAgentSessionScope | undefined {
    if (scope.kind === "project")
        return { kind: "project", projectId: scope.projectId as HappyAgentProjectId };
    if (scope.kind === "workspace")
        return {
            kind: "workspace",
            projectId: scope.projectId as HappyAgentProjectId,
            worktreeId: scope.workspaceId as HappyAgentWorktreeId,
        };
    return undefined;
}

function sessionsCollect(
    projects: readonly ProjectGroup[],
    bots: readonly BotGroup[],
    tasks: readonly TaskGroup[],
): Map<string, GroupSession> {
    const sessions = new Map<string, GroupSession>();
    const subtasksCollect = (subtasks: readonly BotSubtaskGroup[]): void => {
        for (const subtask of subtasks) {
            sessions.set(subtask.session.id, subtask.session);
            subtasksCollect(subtask.subtasks);
        }
    };
    for (const project of projects) {
        for (const session of project.sessions) sessions.set(session.id, session);
        for (const workspace of project.workspaces)
            for (const session of workspace.sessions) sessions.set(session.id, session);
    }
    for (const owner of [...bots, ...tasks]) {
        sessions.set(owner.session.id, owner.session);
        subtasksCollect(owner.subtasks);
    }
    return sessions;
}
