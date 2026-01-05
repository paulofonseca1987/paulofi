/**
 * Snapshot.org GraphQL API client for fetching votes
 */

const SNAPSHOT_GRAPHQL_URL = 'https://hub.snapshot.org/graphql';

export interface SnapshotVote {
  id: string;
  voter: string;
  created: number;
  choice: number | number[] | Record<string, number>;  // single, ranked, or weighted
  reason: string;
  vp: number;
  proposal: {
    id: string;
    title: string;
    created: number;
    snapshot: string; // block number as string
    start: number;
    end: number;
    type: string;     // basic, single-choice, ranked-choice, weighted, etc.
    choices: string[]; // array of choice labels
  };
}

interface SnapshotVotesResponse {
  data: {
    votes: SnapshotVote[];
  };
}

/**
 * Fetch all votes by a voter address in a specific space
 */
export async function fetchSnapshotVotes(
  voterAddress: string,
  space: string,
  minBlock?: number,
  maxBlock?: number
): Promise<SnapshotVote[]> {
  const allVotes: SnapshotVote[] = [];
  let skip = 0;
  const first = 1000;

  while (true) {
    const query = `
      query Votes($voter: String!, $space: String!, $first: Int!, $skip: Int!) {
        votes(
          where: { voter: $voter, space: $space }
          first: $first
          skip: $skip
          orderBy: "created"
          orderDirection: desc
        ) {
          id
          voter
          created
          choice
          reason
          vp
          proposal {
            id
            title
            created
            snapshot
            start
            end
            type
            choices
          }
        }
      }
    `;

    const response = await fetch(SNAPSHOT_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          voter: voterAddress.toLowerCase(),
          space,
          first,
          skip,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Snapshot API error: ${response.status} ${response.statusText}`);
    }

    const result: SnapshotVotesResponse = await response.json();

    if (!result.data?.votes || result.data.votes.length === 0) {
      break;
    }

    // Filter by block range if specified
    const filteredVotes = result.data.votes.filter((vote) => {
      const snapshotBlock = parseInt(vote.proposal.snapshot, 10);
      if (minBlock && snapshotBlock < minBlock) return false;
      if (maxBlock && snapshotBlock > maxBlock) return false;
      return true;
    });

    allVotes.push(...filteredVotes);

    // If we got less than requested, we've reached the end
    if (result.data.votes.length < first) {
      break;
    }

    skip += first;

    // Rate limiting - be nice to the API
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return allVotes;
}

/**
 * Get proposal details by ID
 */
export async function fetchProposalDetails(proposalId: string): Promise<{
  id: string;
  title: string;
  created: number;
  snapshot: string;
  start: number;
  end: number;
} | null> {
  const query = `
    query Proposal($id: String!) {
      proposal(id: $id) {
        id
        title
        created
        snapshot
        start
        end
      }
    }
  `;

  const response = await fetch(SNAPSHOT_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { id: proposalId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Snapshot API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data?.proposal || null;
}
