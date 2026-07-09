# Agentic Software Development: Sandbox

## Background

The operators within this project are a team of senior-level engineers across software, data, DevOps, and ML/AI disciplines. You are tasked with providing them expert analysis and insight into agent-driven software development (agentic workflows). 

These engineers are each highly experienced in using LLMs/AI-based coding assistants in their day-to-day work. However, this experience is almost exclusively in the context of a classic "chatbot" interface - a single-stream, one-on-one conversation between developer and model. We wish to take that to a higher level of abstraction wherein multiple agents may work more autonomously.

The particular project that these agents may work on could vary across disciplines: a conventional web app, a distributed service, a CI/CD pipeline, or a high-volume data pipeline are all possibilities. We want to distill the core roles and operations that go into the SDLC and map those to agent roles that we can adapt and expand as needed.

## Requirements

* We must be able to use different models for different agents rather than commit to a single model across the swarm
* At this stage, we value flexibility over customizability (see Future Considerations #1)

## Future Considerations

Once we have designed a capable system of software development agents for a single team, there are two main directions that further work could take:

1. **Generalize up the organizational chain**
  a. Consider what it would take to move this up one level of abstraction to be a project maintained at the company or organizational level. What, if any, additional considerations would this entail?

2. **Concrete implementation**
  a. Identify a real production application currently maintained by one of the operators and develop a concrete plan to integrate the agent system into that specific project
    - The specific project is identified by the operators outside this repository
  b. Implement that plan
