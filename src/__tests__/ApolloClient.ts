import gql from "graphql-tag";

import {
  ApolloClient,
  ApolloError,
  ApolloQueryResult,
  DefaultOptions,
  ObservableQuery,
  QueryOptions,
  makeReference,
} from "../core";
import { Kind } from "graphql";

import { DeepPartial, Observable } from "../utilities";
import { ApolloLink, FetchResult } from "../link/core";
import { HttpLink } from "../link/http";
import { createFragmentRegistry, InMemoryCache } from "../cache";
import { ObservableStream, spyOnConsole } from "../testing/internal";
import { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { invariant } from "../utilities/globals";
import { expectTypeOf } from "expect-type";
import { Masked } from "../masking";

describe("ApolloClient", () => {
  describe("constructor", () => {
    let oldFetch: any;

    beforeEach(() => {
      oldFetch = window.fetch;
      window.fetch = () => null as any;
    });

    afterEach(() => {
      window.fetch = oldFetch;
    });

    it("will throw an error if cache is not passed in", () => {
      expect(() => {
        new ApolloClient({ link: ApolloLink.empty() } as any);
      }).toThrowErrorMatchingSnapshot();
    });

    it("should create an `HttpLink` instance if `uri` is provided", () => {
      const uri = "http://localhost:4000";
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        uri,
      });

      expect(client.link).toBeDefined();
      expect((client.link as HttpLink).options.uri).toEqual(uri);
    });

    it("should accept `link` over `uri` if both are provided", () => {
      const uri1 = "http://localhost:3000";
      const uri2 = "http://localhost:4000";
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        uri: uri1,
        link: new HttpLink({ uri: uri2 }),
      });
      expect((client.link as HttpLink).options.uri).toEqual(uri2);
    });

    it("should create an empty Link if `uri` and `link` are not provided", () => {
      const client = new ApolloClient({
        cache: new InMemoryCache(),
      });
      expect(client.link).toBeDefined();
      expect(client.link instanceof ApolloLink).toBeTruthy();
    });
  });

  describe("readQuery", () => {
    it("will read some data from the store", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          ROOT_QUERY: {
            a: 1,
            b: 2,
            c: 3,
          },
        }),
      });

      expect(
        client.readQuery({
          query: gql`
            {
              a
            }
          `,
        })
      ).toEqual({ a: 1 });
      expect(
        client.readQuery({
          query: gql`
            {
              b
              c
            }
          `,
        })
      ).toEqual({ b: 2, c: 3 });
      expect(
        client.readQuery({
          query: gql`
            {
              a
              b
              c
            }
          `,
        })
      ).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("will read some deeply nested data from the store", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          ROOT_QUERY: {
            a: 1,
            b: 2,
            c: 3,
            d: makeReference("foo"),
          },
          foo: {
            __typename: "Foo",
            e: 4,
            f: 5,
            g: 6,
            h: makeReference("bar"),
          },
          bar: {
            __typename: "Bar",
            i: 7,
            j: 8,
            k: 9,
          },
        }),
      });

      expect(
        client.readQuery({
          query: gql`
            {
              a
              d {
                e
              }
            }
          `,
        })
      ).toEqual({ a: 1, d: { e: 4, __typename: "Foo" } });
      expect(
        client.readQuery({
          query: gql`
            {
              a
              d {
                e
                h {
                  i
                }
              }
            }
          `,
        })
      ).toEqual({
        a: 1,
        d: { __typename: "Foo", e: 4, h: { i: 7, __typename: "Bar" } },
      });
      expect(
        client.readQuery({
          query: gql`
            {
              a
              b
              c
              d {
                e
                f
                g
                h {
                  i
                  j
                  k
                }
              }
            }
          `,
        })
      ).toEqual({
        a: 1,
        b: 2,
        c: 3,
        d: {
          __typename: "Foo",
          e: 4,
          f: 5,
          g: 6,
          h: { __typename: "Bar", i: 7, j: 8, k: 9 },
        },
      });
    });

    it("will read some data from the store with variables", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          ROOT_QUERY: {
            'field({"literal":true,"value":42})': 1,
            'field({"literal":false,"value":42})': 2,
          },
        }),
      });

      expect(
        client.readQuery({
          query: gql`
            query ($literal: Boolean, $value: Int) {
              a: field(literal: true, value: 42)
              b: field(literal: $literal, value: $value)
            }
          `,
          variables: {
            literal: false,
            value: 42,
          },
        })
      ).toEqual({ a: 1, b: 2 });
    });
  });

  it("will read some data from the store with default values", () => {
    const client = new ApolloClient({
      link: ApolloLink.empty(),
      cache: new InMemoryCache().restore({
        ROOT_QUERY: {
          'field({"literal":true,"value":-1})': 1,
          'field({"literal":false,"value":42})': 2,
        },
      }),
    });

    expect(
      client.readQuery({
        query: gql`
          query ($literal: Boolean, $value: Int = -1) {
            a: field(literal: $literal, value: $value)
          }
        `,
        variables: {
          literal: false,
          value: 42,
        },
      })
    ).toEqual({ a: 2 });

    expect(
      client.readQuery({
        query: gql`
          query ($literal: Boolean, $value: Int = -1) {
            a: field(literal: $literal, value: $value)
          }
        `,
        variables: {
          literal: true,
        },
      })
    ).toEqual({ a: 1 });
  });

  describe("readFragment", () => {
    it("will throw an error when there is no fragment", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      expect(() => {
        client.readFragment({
          id: "x",
          fragment: gql`
            query {
              a
              b
              c
            }
          `,
        });
      }).toThrowError(
        "Found a query operation. No operations are allowed when using a fragment as a query. Only fragments are allowed."
      );
      expect(() => {
        client.readFragment({
          id: "x",
          fragment: gql`
            schema {
              query: Query
            }
          `,
        });
      }).toThrowError(
        "Found 0 fragments. `fragmentName` must be provided when there is not exactly 1 fragment."
      );
    });

    it("will throw an error when there is more than one fragment but no fragment name", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      expect(() => {
        client.readFragment({
          id: "x",
          fragment: gql`
            fragment a on A {
              a
            }

            fragment b on B {
              b
            }
          `,
        });
      }).toThrowError(
        "Found 2 fragments. `fragmentName` must be provided when there is not exactly 1 fragment."
      );
      expect(() => {
        client.readFragment({
          id: "x",
          fragment: gql`
            fragment a on A {
              a
            }

            fragment b on B {
              b
            }

            fragment c on C {
              c
            }
          `,
        });
      }).toThrowError(
        "Found 3 fragments. `fragmentName` must be provided when there is not exactly 1 fragment."
      );
    });

    it("will read some deeply nested data from the store at any id", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          ROOT_QUERY: {
            __typename: "Foo",
            a: 1,
            b: 2,
            c: 3,
            d: makeReference("foo"),
          },
          foo: {
            __typename: "Foo",
            e: 4,
            f: 5,
            g: 6,
            h: makeReference("bar"),
          },
          bar: {
            __typename: "Bar",
            i: 7,
            j: 8,
            k: 9,
          },
        }),
      });

      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment fragmentFoo on Foo {
              e
              h {
                i
              }
            }
          `,
        })
      ).toEqual({ __typename: "Foo", e: 4, h: { __typename: "Bar", i: 7 } });
      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment fragmentFoo on Foo {
              e
              f
              g
              h {
                i
                j
                k
              }
            }
          `,
        })
      ).toEqual({
        __typename: "Foo",
        e: 4,
        f: 5,
        g: 6,
        h: { __typename: "Bar", i: 7, j: 8, k: 9 },
      });
      expect(
        client.readFragment({
          id: "bar",
          fragment: gql`
            fragment fragmentBar on Bar {
              i
            }
          `,
        })
      ).toEqual({ __typename: "Bar", i: 7 });
      expect(
        client.readFragment({
          id: "bar",
          fragment: gql`
            fragment fragmentBar on Bar {
              i
              j
              k
            }
          `,
        })
      ).toEqual({ __typename: "Bar", i: 7, j: 8, k: 9 });
      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment fragmentFoo on Foo {
              e
              f
              g
              h {
                i
                j
                k
              }
            }

            fragment fragmentBar on Bar {
              i
              j
              k
            }
          `,
          fragmentName: "fragmentFoo",
        })
      ).toEqual({
        __typename: "Foo",
        e: 4,
        f: 5,
        g: 6,
        h: { __typename: "Bar", i: 7, j: 8, k: 9 },
      });
      expect(
        client.readFragment({
          id: "bar",
          fragment: gql`
            fragment fragmentFoo on Foo {
              e
              f
              g
              h {
                i
                j
                k
              }
            }

            fragment fragmentBar on Bar {
              i
              j
              k
            }
          `,
          fragmentName: "fragmentBar",
        })
      ).toEqual({ __typename: "Bar", i: 7, j: 8, k: 9 });
    });

    it("will read some data from the store with variables", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          foo: {
            __typename: "Foo",
            'field({"literal":true,"value":42})': 1,
            'field({"literal":false,"value":42})': 2,
          },
        }),
      });

      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment foo on Foo {
              a: field(literal: true, value: 42)
              b: field(literal: $literal, value: $value)
            }
          `,
          variables: {
            literal: false,
            value: 42,
          },
        })
      ).toEqual({ __typename: "Foo", a: 1, b: 2 });
    });

    it("will return null when an id that can’t be found is provided", () => {
      const client1 = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });
      const client2 = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          bar: { __typename: "Foo", a: 1, b: 2, c: 3 },
        }),
      });
      const client3 = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache().restore({
          foo: { __typename: "Foo", a: 1, b: 2, c: 3 },
        }),
      });

      expect(
        client1.readFragment({
          id: "foo",
          fragment: gql`
            fragment fooFragment on Foo {
              a
              b
              c
            }
          `,
        })
      ).toBe(null);
      expect(
        client2.readFragment({
          id: "foo",
          fragment: gql`
            fragment fooFragment on Foo {
              a
              b
              c
            }
          `,
        })
      ).toBe(null);
      expect(
        client3.readFragment({
          id: "foo",
          fragment: gql`
            fragment fooFragment on Foo {
              a
              b
              c
            }
          `,
        })
      ).toEqual({ __typename: "Foo", a: 1, b: 2, c: 3 });
    });
  });

  describe("writeQuery", () => {
    it("will write some data to the store", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        data: { a: 1 },
        query: gql`
          {
            a
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 1,
        },
      });

      client.writeQuery({
        data: { b: 2, c: 3 },
        query: gql`
          {
            b
            c
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 1,
          b: 2,
          c: 3,
        },
      });

      client.writeQuery({
        data: { a: 4, b: 5, c: 6 },
        query: gql`
          {
            a
            b
            c
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 4,
          b: 5,
          c: 6,
        },
      });
    });

    it("will write some deeply nested data to the store", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          typePolicies: {
            Query: {
              fields: {
                d: {
                  // Silence "Cache data may be lost..."  warnings by
                  // unconditionally favoring the incoming data.
                  merge: false,
                },
              },
            },
          },
        }),
      });

      client.writeQuery({
        data: { a: 1, d: { __typename: "D", e: 4 } },
        query: gql`
          {
            a
            d {
              e
            }
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeQuery({
        data: { a: 1, d: { __typename: "D", h: { __typename: "H", i: 7 } } },
        query: gql`
          {
            a
            d {
              h {
                i
              }
            }
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeQuery({
        data: {
          a: 1,
          b: 2,
          c: 3,
          d: {
            __typename: "D",
            e: 4,
            f: 5,
            g: 6,
            h: {
              __typename: "H",
              i: 7,
              j: 8,
              k: 9,
            },
          },
        },
        query: gql`
          {
            a
            b
            c
            d {
              e
              f
              g
              h {
                i
                j
                k
              }
            }
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will write some data to the store with variables", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        data: {
          a: 1,
          b: 2,
        },
        query: gql`
          query ($literal: Boolean, $value: Int) {
            a: field(literal: true, value: 42)
            b: field(literal: $literal, value: $value)
          }
        `,
        variables: {
          literal: false,
          value: 42,
        },
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          'field({"literal":true,"value":42})': 1,
          'field({"literal":false,"value":42})': 2,
        },
      });
    });

    it("will write some data to the store with default values for variables", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        data: {
          a: 2,
        },
        query: gql`
          query ($literal: Boolean, $value: Int = -1) {
            a: field(literal: $literal, value: $value)
          }
        `,
        variables: {
          literal: true,
          value: 42,
        },
      });

      client.writeQuery({
        data: {
          a: 1,
        },
        query: gql`
          query ($literal: Boolean, $value: Int = -1) {
            a: field(literal: $literal, value: $value)
          }
        `,
        variables: {
          literal: false,
        },
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          'field({"literal":true,"value":42})': 2,
          'field({"literal":false,"value":-1})': 1,
        },
      });
    });

    it("should warn when the data provided does not match the query shape", () => {
      using _consoleSpies = spyOnConsole.takeSnapshots("error");
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          // Passing an empty map enables the warning:
          possibleTypes: {},
        }),
      });

      client.writeQuery({
        data: {
          todos: [
            {
              id: "1",
              name: "Todo 1",
              __typename: "Todo",
            },
          ],
        },
        query: gql`
          query {
            todos {
              id
              name
              description
            }
          }
        `,
      });
    });
  });

  describe("writeFragment", () => {
    it("will throw an error when there is no fragment", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      expect(() => {
        client.writeFragment({
          data: {},
          id: "x",
          fragment: gql`
            query {
              a
              b
              c
            }
          `,
        });
      }).toThrowError(
        "Found a query operation. No operations are allowed when using a fragment as a query. Only fragments are allowed."
      );
      expect(() => {
        client.writeFragment({
          data: {},
          id: "x",
          fragment: gql`
            schema {
              query: Query
            }
          `,
        });
      }).toThrowError(
        "Found 0 fragments. `fragmentName` must be provided when there is not exactly 1 fragment."
      );
    });

    it("will throw an error when there is more than one fragment but no fragment name", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      expect(() => {
        client.writeFragment({
          data: {},
          id: "x",
          fragment: gql`
            fragment a on A {
              a
            }

            fragment b on B {
              b
            }
          `,
        });
      }).toThrowError(
        "Found 2 fragments. `fragmentName` must be provided when there is not exactly 1 fragment."
      );
      expect(() => {
        client.writeFragment({
          data: {},
          id: "x",
          fragment: gql`
            fragment a on A {
              a
            }

            fragment b on B {
              b
            }

            fragment c on C {
              c
            }
          `,
        });
      }).toThrowError(
        "Found 3 fragments. `fragmentName` must be provided when there is not exactly 1 fragment."
      );
    });

    it("will write some deeply nested data into the store at any id", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({ dataIdFromObject: (o: any) => o.id }),
      });

      client.writeFragment({
        data: {
          __typename: "Foo",
          e: 4,
          h: { __typename: "Bar", id: "bar", i: 7 },
        },
        id: "foo",
        fragment: gql`
          fragment fragmentFoo on Foo {
            e
            h {
              i
            }
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeFragment({
        data: {
          __typename: "Foo",
          f: 5,
          g: 6,
          h: { __typename: "Bar", id: "bar", j: 8, k: 9 },
        },
        id: "foo",
        fragment: gql`
          fragment fragmentFoo on Foo {
            f
            g
            h {
              j
              k
            }
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeFragment({
        data: { __typename: "Bar", i: 10 },
        id: "bar",
        fragment: gql`
          fragment fragmentBar on Bar {
            i
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeFragment({
        data: { __typename: "Bar", j: 11, k: 12 },
        id: "bar",
        fragment: gql`
          fragment fragmentBar on Bar {
            j
            k
          }
        `,
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeFragment({
        data: {
          __typename: "Foo",
          e: 4,
          f: 5,
          g: 6,
          h: { __typename: "Bar", id: "bar", i: 7, j: 8, k: 9 },
        },
        id: "foo",
        fragment: gql`
          fragment fooFragment on Foo {
            e
            f
            g
            h {
              i
              j
              k
            }
          }

          fragment barFragment on Bar {
            i
            j
            k
          }
        `,
        fragmentName: "fooFragment",
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();

      client.writeFragment({
        data: { __typename: "Bar", i: 10, j: 11, k: 12 },
        id: "bar",
        fragment: gql`
          fragment fooFragment on Foo {
            e
            f
            g
            h {
              i
              j
              k
            }
          }

          fragment barFragment on Bar {
            i
            j
            k
          }
        `,
        fragmentName: "barFragment",
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will write some data to the store with variables", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeFragment({
        data: {
          __typename: "Foo",
          a: 1,
          b: 2,
        },
        id: "foo",
        fragment: gql`
          fragment foo on Foo {
            a: field(literal: true, value: 42)
            b: field(literal: $literal, value: $value)
          }
        `,
        variables: {
          literal: false,
          value: 42,
        },
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        __META: {
          extraRootIds: ["foo"],
        },
        foo: {
          __typename: "Foo",
          'field({"literal":true,"value":42})': 1,
          'field({"literal":false,"value":42})': 2,
        },
      });
    });

    it("should warn when the data provided does not match the fragment shape", () => {
      using _consoleSpies = spyOnConsole.takeSnapshots("error");
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          // Passing an empty map enables the warning:
          possibleTypes: {},
        }),
      });

      client.writeFragment({
        data: { __typename: "Bar", i: 10 },
        id: "bar",
        fragment: gql`
          fragment fragmentBar on Bar {
            i
            e
          }
        `,
      });
    });

    describe("change will call observable next", () => {
      const query = gql`
        query nestedData {
          people {
            id
            friends {
              id
              type
            }
          }
        }
      `;

      interface Friend {
        id: number;
        type: string;
        __typename: string;
      }
      interface Data {
        people: {
          id: number;
          __typename: string;
          friends: Friend[];
        };
      }
      const bestFriend = {
        id: 1,
        type: "best",
        __typename: "Friend",
      };
      const badFriend = {
        id: 2,
        type: "bad",
        __typename: "Friend",
      };
      const data = {
        people: {
          id: 1,
          __typename: "Person",
          friends: [bestFriend, badFriend],
        },
      };
      const link = new ApolloLink(() => {
        return Observable.of({ data });
      });
      function newClient() {
        return new ApolloClient({
          link,
          cache: new InMemoryCache({
            typePolicies: {
              Person: {
                fields: {
                  friends: {
                    // Deliberately silence "Cache data may be lost..."
                    // warnings by preferring the incoming data, rather
                    // than (say) concatenating the arrays together.
                    merge: false,
                  },
                },
              },
            },
            dataIdFromObject: (result) => {
              if (result.id && result.__typename) {
                return result.__typename + result.id;
              }
            },
            addTypename: true,
          }),
        });
      }

      describe("using writeQuery", () => {
        it("with TypedDocumentNode", async () => {
          const client = newClient();

          // This is defined manually for the purpose of the test, but
          // eventually this could be generated with graphql-code-generator
          const typedQuery: TypedDocumentNode<Data, { testVar: string }> =
            query;

          // The result and variables are being typed automatically, based on the query object we pass,
          // and type inference is done based on the TypeDocumentNode object.
          const result = await client.query({
            query: typedQuery,
            variables: { testVar: "foo" },
          });

          // Just try to access it, if something will break, TS will throw an error
          // during the test
          result.data?.people.friends[0].id;
        });

        it("with a replacement of nested array (wq)", async () => {
          const client = newClient();
          const observable = client.watchQuery<Data>({ query });
          const stream = new ObservableStream(observable);

          await expect(stream).toEmitMatchedValue({ data });
          expect(observable.getCurrentResult().data).toEqual(data);

          const readData = client.readQuery<Data>({ query });
          expect(readData).toEqual(data);

          // modify readData and writeQuery
          const bestFriends = readData!.people.friends.filter(
            (x) => x.type === "best"
          );
          // this should re call next
          client.writeQuery<Data>({
            query,
            data: {
              people: {
                id: 1,
                friends: bestFriends,
                __typename: "Person",
              },
            },
          });

          const expectation = {
            people: {
              id: 1,
              friends: [bestFriend],
              __typename: "Person",
            },
          };

          await expect(stream).toEmitMatchedValue({ data: expectation });
          expect(client.readQuery<Data>({ query })).toEqual(expectation);
        });

        it("with a value change inside a nested array (wq)", async () => {
          const client = newClient();
          const observable = client.watchQuery<Data>({ query });
          const stream = new ObservableStream(observable);

          await expect(stream).toEmitMatchedValue({ data });

          expect(observable.getCurrentResult().data).toEqual(data);

          const readData = client.readQuery<Data>({ query });
          expect(readData).toEqual(data);

          // modify readData and writeQuery
          const friends = readData!.people.friends.slice();
          friends[0] = { ...friends[0], type: "okayest" };
          friends[1] = { ...friends[1], type: "okayest" };

          // this should re call next
          client.writeQuery<Data>({
            query,
            data: {
              people: {
                id: 1,
                friends,
                __typename: "Person",
              },
            },
          });

          const expectation0 = {
            ...bestFriend,
            type: "okayest",
          };
          const expectation1 = {
            ...badFriend,
            type: "okayest",
          };

          const nextResult = await stream.takeNext();
          const nextFriends = nextResult.data!.people.friends;

          expect(nextFriends[0]).toEqual(expectation0);
          expect(nextFriends[1]).toEqual(expectation1);

          const readFriends = client.readQuery<Data>({ query })!.people.friends;
          expect(readFriends[0]).toEqual(expectation0);
          expect(readFriends[1]).toEqual(expectation1);
        });
      });

      describe("using writeFragment", () => {
        it("with a replacement of nested array (wf)", async () => {
          const client = newClient();
          const observable = client.watchQuery<Data>({ query });
          const stream = new ObservableStream(observable);

          {
            const result = await stream.takeNext();

            expect(result.data).toEqual(data);
            expect(observable.getCurrentResult().data).toEqual(data);

            const bestFriends = result.data!.people.friends.filter(
              (x) => x.type === "best"
            );

            // this should re call next
            client.writeFragment({
              id: `Person${result.data!.people.id}`,
              fragment: gql`
                fragment bestFriends on Person {
                  friends {
                    id
                  }
                }
              `,
              data: {
                friends: bestFriends,
                __typename: "Person",
              },
            });
          }

          {
            const result = await stream.takeNext();
            expect(result.data!.people.friends).toEqual([bestFriend]);
          }
        });

        it("with a value change inside a nested array (wf)", async () => {
          const client = newClient();
          const observable = client.watchQuery<Data>({ query });
          const stream = new ObservableStream(observable);

          {
            const result = await stream.takeNext();

            expect(result.data).toEqual(data);
            expect(observable.getCurrentResult().data).toEqual(data);
            const friends = result.data!.people.friends;

            // this should re call next
            client.writeFragment({
              id: `Person${result.data!.people.id}`,
              fragment: gql`
                fragment bestFriends on Person {
                  friends {
                    id
                    type
                  }
                }
              `,
              data: {
                friends: [
                  { ...friends[0], type: "okayest" },
                  { ...friends[1], type: "okayest" },
                ],
                __typename: "Person",
              },
            });
          }

          {
            const result = await stream.takeNext();
            const nextFriends = result.data!.people.friends;

            expect(nextFriends[0]).toEqual({
              ...bestFriend,
              type: "okayest",
            });
            expect(nextFriends[1]).toEqual({
              ...badFriend,
              type: "okayest",
            });
          }
        });
      });
    });
  });

  describe("write then read", () => {
    it("will write data locally which will then be read back", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          dataIdFromObject(object) {
            if (typeof object.__typename === "string") {
              return object.__typename.toLowerCase();
            }
          },
        }).restore({
          foo: {
            __typename: "Foo",
            a: 1,
            b: 2,
            c: 3,
            bar: makeReference("bar"),
          },
          bar: {
            __typename: "Bar",
            d: 4,
            e: 5,
            f: 6,
          },
        }),
      });

      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment x on Foo {
              a
              b
              c
              bar {
                d
                e
                f
              }
            }
          `,
        })
      ).toEqual({
        __typename: "Foo",
        a: 1,
        b: 2,
        c: 3,
        bar: { d: 4, e: 5, f: 6, __typename: "Bar" },
      });

      client.writeFragment({
        id: "foo",
        fragment: gql`
          fragment x on Foo {
            a
          }
        `,
        data: { __typename: "Foo", a: 7 },
      });

      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment x on Foo {
              a
              b
              c
              bar {
                d
                e
                f
              }
            }
          `,
        })
      ).toEqual({
        __typename: "Foo",
        a: 7,
        b: 2,
        c: 3,
        bar: { __typename: "Bar", d: 4, e: 5, f: 6 },
      });

      client.writeFragment({
        id: "foo",
        fragment: gql`
          fragment x on Foo {
            bar {
              d
            }
          }
        `,
        data: { __typename: "Foo", bar: { __typename: "Bar", d: 8 } },
      });

      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment x on Foo {
              a
              b
              c
              bar {
                d
                e
                f
              }
            }
          `,
        })
      ).toEqual({
        __typename: "Foo",
        a: 7,
        b: 2,
        c: 3,
        bar: { __typename: "Bar", d: 8, e: 5, f: 6 },
      });

      client.writeFragment({
        id: "bar",
        fragment: gql`
          fragment y on Bar {
            e
          }
        `,
        data: { __typename: "Bar", e: 9 },
      });

      expect(
        client.readFragment({
          id: "foo",
          fragment: gql`
            fragment x on Foo {
              a
              b
              c
              bar {
                d
                e
                f
              }
            }
          `,
        })
      ).toEqual({
        __typename: "Foo",
        a: 7,
        b: 2,
        c: 3,
        bar: { __typename: "Bar", d: 8, e: 9, f: 6 },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will write data to a specific id", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          dataIdFromObject: (o: any) => o.key,
        }),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                key
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: {
            __typename: "foo",
            c: 3,
            d: 4,
            bar: { key: "foobar", __typename: "bar", e: 5, f: 6 },
          },
        },
      });

      expect(
        client.readQuery({
          query: gql`
            {
              a
              b
              foo {
                c
                d
                bar {
                  key
                  e
                  f
                }
              }
            }
          `,
        })
      ).toEqual({
        a: 1,
        b: 2,
        foo: {
          __typename: "foo",
          c: 3,
          d: 4,
          bar: { __typename: "bar", key: "foobar", e: 5, f: 6 },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will not use a default id getter if __typename is not present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          addTypename: false,
        }),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: { c: 3, d: 4, bar: { id: "foobar", e: 5, f: 6 } },
        },
      });

      client.writeQuery({
        query: gql`
          {
            g
            h
            bar {
              i
              j
              foo {
                _id
                k
                l
              }
            }
          }
        `,
        data: {
          g: 8,
          h: 9,
          bar: { i: 10, j: 11, foo: { _id: "barfoo", k: 12, l: 13 } },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 1,
          b: 2,
          g: 8,
          h: 9,
          bar: {
            i: 10,
            j: 11,
            foo: {
              _id: "barfoo",
              k: 12,
              l: 13,
            },
          },
          foo: {
            c: 3,
            d: 4,
            bar: {
              id: "foobar",
              e: 5,
              f: 6,
            },
          },
        },
      });
    });

    it("will not use a default id getter if id and _id are not present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: {
            __typename: "foo",
            c: 3,
            d: 4,
            bar: { __typename: "bar", e: 5, f: 6 },
          },
        },
      });

      client.writeQuery({
        query: gql`
          {
            g
            h
            bar {
              i
              j
              foo {
                k
                l
              }
            }
          }
        `,
        data: {
          g: 8,
          h: 9,
          bar: {
            __typename: "bar",
            i: 10,
            j: 11,
            foo: { __typename: "foo", k: 12, l: 13 },
          },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will use a default id getter if __typename and id are present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: {
            __typename: "foo",
            c: 3,
            d: 4,
            bar: { __typename: "bar", id: "foobar", e: 5, f: 6 },
          },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will use a default id getter if __typename and _id are present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                _id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: {
            __typename: "foo",
            c: 3,
            d: 4,
            bar: { __typename: "bar", _id: "foobar", e: 5, f: 6 },
          },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will not use a default id getter if id is present and __typename is not present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          addTypename: false,
        }),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: { c: 3, d: 4, bar: { id: "foobar", e: 5, f: 6 } },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 1,
          b: 2,
          foo: {
            c: 3,
            d: 4,
            bar: {
              id: "foobar",
              e: 5,
              f: 6,
            },
          },
        },
      });
    });

    it("will not use a default id getter if _id is present but __typename is not present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          addTypename: false,
        }),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                _id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: { c: 3, d: 4, bar: { _id: "foobar", e: 5, f: 6 } },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 1,
          b: 2,
          foo: {
            c: 3,
            d: 4,
            bar: {
              _id: "foobar",
              e: 5,
              f: 6,
            },
          },
        },
      });
    });

    it("will not use a default id getter if either _id or id is present when __typename is not also present", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache({
          addTypename: false,
        }),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: {
            c: 3,
            d: 4,
            bar: { __typename: "bar", id: "foobar", e: 5, f: 6 },
          },
        },
      });

      client.writeQuery({
        query: gql`
          {
            g
            h
            bar {
              i
              j
              foo {
                _id
                k
                l
              }
            }
          }
        `,
        data: {
          g: 8,
          h: 9,
          bar: { i: 10, j: 11, foo: { _id: "barfoo", k: 12, l: 13 } },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });

    it("will use a default id getter if one is not specified and __typename is present along with either _id or id", () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });

      client.writeQuery({
        query: gql`
          {
            a
            b
            foo {
              c
              d
              bar {
                id
                e
                f
              }
            }
          }
        `,
        data: {
          a: 1,
          b: 2,
          foo: {
            __typename: "foo",
            c: 3,
            d: 4,
            bar: { __typename: "bar", id: "foobar", e: 5, f: 6 },
          },
        },
      });

      client.writeQuery({
        query: gql`
          {
            g
            h
            bar {
              i
              j
              foo {
                _id
                k
                l
              }
            }
          }
        `,
        data: {
          g: 8,
          h: 9,
          bar: {
            __typename: "bar",
            i: 10,
            j: 11,
            foo: { __typename: "foo", _id: "barfoo", k: 12, l: 13 },
          },
        },
      });

      expect((client.cache as InMemoryCache).extract()).toMatchSnapshot();
    });
  });

  describe("watchQuery", () => {
    it(
      "should change the `fetchPolicy` to `cache-first` if network fetching " +
        "is disabled, and the incoming `fetchPolicy` is set to " +
        "`network-only` or `cache-and-network`",
      () => {
        const client = new ApolloClient({
          link: ApolloLink.empty(),
          cache: new InMemoryCache(),
        });
        client.disableNetworkFetches = true;

        const query = gql`
          query someData {
            foo {
              bar
            }
          }
        `;

        (["network-only", "cache-and-network"] as const).forEach(
          (fetchPolicy) => {
            const observable = client.watchQuery({
              query,
              fetchPolicy,
            });
            expect(observable.options.fetchPolicy).toEqual("cache-first");
          }
        );
      }
    );

    it(
      "should not change the incoming `fetchPolicy` if network fetching " +
        "is enabled",
      () => {
        const client = new ApolloClient({
          link: ApolloLink.empty(),
          cache: new InMemoryCache(),
        });
        client.disableNetworkFetches = false;

        const query = gql`
          query someData {
            foo {
              bar
            }
          }
        `;

        (
          [
            "cache-first",
            "cache-and-network",
            "network-only",
            "cache-only",
            "no-cache",
          ] as const
        ).forEach((fetchPolicy) => {
          const observable = client.watchQuery({
            query,
            fetchPolicy,
          });
          expect(observable.options.fetchPolicy).toEqual(fetchPolicy);
        });
      }
    );
  });

  describe("watchFragment", () => {
    it("if all data is available, `complete` is `true`", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text
        }
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
          },
          complete: true,
        });
      }
    });
    it("cache writes emit a new value", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text
        }
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
          },
          complete: true,
        });
      }

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5 (edited)",
        },
      });

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5 (edited)",
          },
          complete: true,
        });
      }
    });
    it("if only partial data is available, `complete` is `false`", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text
        }
      `;

      {
        // we expect a "Missing field 'text' while writing result..." error
        // when writing item to the cache, so we'll silence the console.error
        using _consoleSpy = spyOnConsole("error");
        cache.writeFragment({
          fragment: ItemFragment,
          data: {
            __typename: "Item",
            id: 5,
          },
        });
      }

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
          },
          complete: false,
          missing: {
            text: "Can't find field 'text' on Item:5 object",
          },
        });
      }
    });
    it("if no data is written after observable is subscribed to, next is never called", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text
        }
      `;

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          complete: false,
          data: {},
          missing: "Dangling reference to missing Item:5 object",
        });
      }

      await expect(stream.takeNext({ timeout: 1000 })).rejects.toEqual(
        expect.any(Error)
      );
    });

    it("supports the @nonreactive directive", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text @nonreactive
        }
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
          },
          complete: true,
        });
      }

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5 (edited)",
        },
      });

      await expect(stream.takeNext()).rejects.toThrow(
        new Error("Timeout waiting for next event")
      );
    });
    it("works with `variables`", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text(language: $language)
        }
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
        variables: { language: "Esperanto" },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
        variables: { language: "Esperanto" },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toStrictEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
          },
          complete: true,
        });
      }
    });
    it("supports the @includes directive with `variables`", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });
      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text @include(if: $withText)
        }
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
        variables: { withText: true },
      });
      cache.writeFragment({
        fragment: ItemFragment,
        data: {
          __typename: "Item",
          id: 5,
        },
        variables: { withText: false },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
        variables: { withText: true },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toStrictEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
          },
          complete: true,
        });
      }
    });

    it("supports the @includes directive with `variables` - parallel cache modification", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({ cache });

      const FullFragment = gql`
        fragment ItemFragment on Item {
          id
          text
        }
      `;

      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          ...IncludedFragment @include(if: $withText)
        }

        fragment IncludedFragment on Item {
          id
          text
        }
      `;

      cache.writeFragment({
        fragment: FullFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        from: { __typename: "Item", id: 5 },
        variables: { withText: true },
        fragmentName: "ItemFragment",
      });

      const stream = new ObservableStream(observable);

      await expect(stream).toEmitValueStrict({
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
        },
        complete: true,
      });

      client.writeFragment({
        fragment: FullFragment,
        data: {
          __typename: "Item",
          id: 5,
          text: "changed Item #5",
        },
      });

      await expect(stream).toEmitValueStrict({
        data: {
          __typename: "Item",
          id: 5,
          text: "changed Item #5",
        },
        complete: true,
      });
    });

    it("works with nested fragments", async () => {
      const cache = new InMemoryCache();
      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });

      const ItemNestedFragment = gql`
        fragment ItemNestedFragment on Item {
          complete
        }
      `;

      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text
          ...ItemNestedFragment
        }

        ${ItemNestedFragment}
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        fragmentName: "ItemFragment",
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
          complete: true,
        },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        fragmentName: "ItemFragment",
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
            complete: true,
          },
          complete: true,
        });
      }
    });

    it("can use the fragment registry for nested fragments", async () => {
      const fragments = createFragmentRegistry();
      const cache = new InMemoryCache({ fragments });

      fragments.register(gql`
        fragment ItemNestedFragment on Item {
          complete
        }
      `);

      const client = new ApolloClient({
        cache,
        link: ApolloLink.empty(),
      });

      const ItemFragment = gql`
        fragment ItemFragment on Item {
          id
          text
          ...ItemNestedFragment
        }
      `;

      cache.writeFragment({
        fragment: ItemFragment,
        fragmentName: "ItemFragment",
        data: {
          __typename: "Item",
          id: 5,
          text: "Item #5",
          complete: true,
        },
      });

      const observable = client.watchFragment({
        fragment: ItemFragment,
        fragmentName: "ItemFragment",
        from: { __typename: "Item", id: 5 },
      });

      const stream = new ObservableStream(observable);

      {
        const result = await stream.takeNext();

        expect(result).toEqual({
          data: {
            __typename: "Item",
            id: 5,
            text: "Item #5",
            complete: true,
          },
          complete: true,
        });
      }
    });
  });

  describe("defaultOptions", () => {
    it(
      "should set `defaultOptions` to an empty object if not provided in " +
        "the constructor",
      () => {
        const client = new ApolloClient({
          link: ApolloLink.empty(),
          cache: new InMemoryCache(),
        });
        expect(client.defaultOptions).toEqual({});
      }
    );

    it("should set `defaultOptions` using options passed into the constructor", () => {
      const defaultOptions: DefaultOptions = {
        query: {
          fetchPolicy: "no-cache",
        },
      };
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
        defaultOptions,
      });
      expect(client.defaultOptions).toEqual(defaultOptions);
    });

    it("should use default options (unless overridden) when querying", async () => {
      const defaultOptions: DefaultOptions = {
        query: {
          fetchPolicy: "no-cache",
        },
      };

      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
        defaultOptions,
      });

      let queryOptions: QueryOptions = {
        query: gql`
          {
            a
          }
        `,
      };

      // @ts-ignore
      const queryManager = client.queryManager;
      const _query = queryManager.query;
      queryManager.query = (options) => {
        queryOptions = options;
        return _query(options);
      };

      try {
        await client.query({
          query: gql`
            {
              a
            }
          `,
        });
      } catch (error) {
        // Swallow errors caused by mocking; not part of this test
      }

      expect(queryOptions.fetchPolicy).toEqual(
        defaultOptions.query!.fetchPolicy
      );

      client.stop();
    });

    it("should be able to set all default query options", () => {
      new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
        defaultOptions: {
          query: {
            query: { kind: Kind.DOCUMENT, definitions: [] },
            variables: { foo: "bar" },
            errorPolicy: "none",
            context: undefined,
            fetchPolicy: "cache-first",
            pollInterval: 100,
            notifyOnNetworkStatusChange: true,
            returnPartialData: true,
            partialRefetch: true,
          },
        },
      });
    });
  });

  describe("clearStore", () => {
    it("should remove all data from the store", async () => {
      const client = new ApolloClient({
        link: ApolloLink.empty(),
        cache: new InMemoryCache(),
      });
      interface Data {
        a: number;
      }
      client.writeQuery<Data>({
        data: { a: 1 },
        query: gql`
          {
            a
          }
        `,
      });

      expect((client.cache as any).data.data).toEqual({
        ROOT_QUERY: {
          __typename: "Query",
          a: 1,
        },
      });

      await client.clearStore();
      expect((client.cache as any).data.data).toEqual({});
    });
  });

  describe("setLink", () => {
    it("should override default link with newly set link", async () => {
      const client = new ApolloClient({
        cache: new InMemoryCache(),
      });
      expect(client.link).toBeDefined();

      const newLink = new ApolloLink((operation) => {
        return new Observable((observer) => {
          observer.next({
            data: {
              widgets: [{ name: "Widget 1" }, { name: "Widget 2" }],
            },
          });
          observer.complete();
        });
      });

      client.setLink(newLink);

      const { data } = await client.query({
        query: gql`
          {
            widgets
          }
        `,
      });
      expect(data.widgets).toBeDefined();
      expect(data.widgets.length).toBe(2);
    });
  });

  describe("refetchQueries", () => {
    let invariantDebugSpy: jest.SpyInstance;

    beforeEach(() => {
      invariantDebugSpy = jest.spyOn(invariant, "debug");
    });

    afterEach(() => {
      invariantDebugSpy.mockRestore();
    });

    it("should catch refetchQueries error when not caught explicitly", (done) => {
      expect.assertions(2);
      const linkFn = jest
        .fn(
          () =>
            new Observable<any>((observer) => {
              setTimeout(() => {
                observer.error(new Error("refetch failed"));
              });
            })
        )
        .mockImplementationOnce(() => {
          setTimeout(refetchQueries);
          return Observable.of();
        });

      const client = new ApolloClient({
        link: new ApolloLink(linkFn),
        cache: new InMemoryCache(),
      });

      const query = gql`
        query someData {
          foo {
            bar
          }
        }
      `;

      const observable = client.watchQuery({
        query,
        fetchPolicy: "network-only",
      });

      observable.subscribe({});

      function refetchQueries() {
        const result = client.refetchQueries({
          include: "all",
        });

        result.queries[0].subscribe({
          error() {
            setTimeout(() => {
              expect(invariantDebugSpy).toHaveBeenCalledTimes(1);
              expect(invariantDebugSpy).toHaveBeenCalledWith(
                "In client.refetchQueries, Promise.all promise rejected with error %o",
                new ApolloError({
                  networkError: new Error("refetch failed"),
                })
              );
              done();
            });
          },
        });
      }
    });
  });

  describe.skip("type tests", () => {
    test("client.mutate uses any as masked and unmasked type when using plain DocumentNode", () => {
      const mutation = gql`
        mutation ($id: ID!) {
          updateUser(id: $id) {
            id
            ...UserFields
          }
        }

        fragment UserFields on User {
          age
        }
      `;

      const client = new ApolloClient({ cache: new InMemoryCache() });

      const promise = client.mutate({
        mutation,
        optimisticResponse: { foo: "foo" },
        updateQueries: {
          TestQuery: (_, { mutationResult }) => {
            expectTypeOf(mutationResult.data).toMatchTypeOf<any>();

            return {};
          },
        },
        refetchQueries(result) {
          expectTypeOf(result.data).toMatchTypeOf<any>();

          return "active";
        },
        update(_, result) {
          expectTypeOf(result.data).toMatchTypeOf<any>();
        },
      });

      expectTypeOf(promise).toMatchTypeOf<Promise<FetchResult<any>>>();
    });

    test("client.mutate uses TData type when using plain TypedDocumentNode", () => {
      interface Mutation {
        updateUser: {
          __typename: "User";
          id: string;
          age: number;
        };
      }

      interface Variables {
        id: string;
      }

      const mutation: TypedDocumentNode<Mutation, Variables> = gql`
        mutation ($id: ID!) {
          updateUser(id: $id) {
            id
            ...UserFields
          }
        }

        fragment UserFields on User {
          age
        }
      `;

      const client = new ApolloClient({ cache: new InMemoryCache() });

      const promise = client.mutate({
        variables: { id: "1" },
        mutation,
        optimisticResponse: {
          updateUser: { __typename: "User", id: "1", age: 30 },
        },
        updateQueries: {
          TestQuery: (_, { mutationResult }) => {
            expectTypeOf(mutationResult.data).toMatchTypeOf<
              Mutation | null | undefined
            >();

            return {};
          },
        },
        refetchQueries(result) {
          expectTypeOf(result.data).toMatchTypeOf<
            Mutation | null | undefined
          >();

          return "active";
        },
        update(_, result) {
          expectTypeOf(result.data).toMatchTypeOf<
            Mutation | null | undefined
          >();
        },
      });

      expectTypeOf(promise).toMatchTypeOf<Promise<FetchResult<Mutation>>>();
    });

    test("client.mutate uses masked/unmasked type when using Masked<TData>", async () => {
      type UserFieldsFragment = {
        __typename: "User";
        age: number;
      } & { " $fragmentName": "UserFieldsFragment" };

      type Mutation = {
        updateUser: {
          __typename: "User";
          id: string;
        } & { " $fragmentRefs": { UserFieldsFragment: UserFieldsFragment } };
      };

      type UnmaskedMutation = {
        updateUser: {
          __typename: "User";
          id: string;
          age: number;
        };
      };

      interface Variables {
        id: string;
      }

      const mutation: TypedDocumentNode<Masked<Mutation>, Variables> = gql`
        mutation ($id: ID!) {
          updateUser(id: $id) {
            id
            ...UserFields
          }
        }

        fragment UserFields on User {
          age
        }
      `;

      const client = new ApolloClient({ cache: new InMemoryCache() });

      const result = await client.mutate({
        variables: { id: "1" },
        mutation,
        optimisticResponse: {
          updateUser: { __typename: "User", id: "1", age: 30 },
        },
        updateQueries: {
          TestQuery: (_, { mutationResult }) => {
            expectTypeOf(mutationResult.data).toMatchTypeOf<
              UnmaskedMutation | null | undefined
            >();

            return {};
          },
        },
        refetchQueries(result) {
          expectTypeOf(result.data).toMatchTypeOf<
            UnmaskedMutation | null | undefined
          >();

          return "active";
        },
        update(_, result) {
          expectTypeOf(result.data).toMatchTypeOf<
            UnmaskedMutation | null | undefined
          >();
        },
      });

      expectTypeOf(result.data).toMatchTypeOf<Mutation | null | undefined>();
    });

    test("client.query uses correct masked/unmasked types", async () => {
      type UserFieldsFragment = {
        age: number;
      } & { " $fragmentName": "UserFieldsFragment" };

      type Query = {
        user: {
          __typename: "User";
          id: string;
        } & { " $fragmentRefs": { UserFieldsFragment: UserFieldsFragment } };
      };

      interface Variables {
        id: string;
      }

      const query: TypedDocumentNode<Masked<Query>, Variables> = gql`
        query ($id: ID!) {
          user(id: $id) {
            id
            ...UserFields
          }
        }

        fragment UserFields on User {
          age
        }
      `;

      const client = new ApolloClient({ cache: new InMemoryCache() });
      const result = await client.query({ variables: { id: "1" }, query });

      expectTypeOf(result.data).toMatchTypeOf<Query | null | undefined>();
    });

    test("client.watchQuery uses correct masked/unmasked types", async () => {
      type UserFieldsFragment = {
        __typename: "User";
        age: number;
      } & { " $fragmentName": "UserFieldsFragment" };

      type Query = {
        user: {
          __typename: "User";
          id: string;
        } & { " $fragmentRefs": { UserFieldsFragment: UserFieldsFragment } };
      };

      type UnmaskedQuery = {
        user: {
          __typename: "User";
          id: string;
          age: number;
        };
      };

      type Subscription = {
        updatedUser: {
          __typename: "User";
          id: string;
        } & { " $fragmentRefs": { UserFieldsFragment: UserFieldsFragment } };
      };

      type UnmaskedSubscription = {
        updatedUser: {
          __typename: "User";
          id: string;
          age: number;
        };
      };

      interface Variables {
        id: string;
      }

      const query: TypedDocumentNode<Masked<Query>, Variables> = gql`
        query ($id: ID!) {
          user(id: $id) {
            id
            ...UserFields
          }
        }

        fragment UserFields on User {
          age
        }
      `;

      const subscription: TypedDocumentNode<
        Masked<Subscription>,
        Variables
      > = gql`
        subscription ($id: ID!) {
          updatedUser(id: $id) {
            id
            ...UserFields
          }
        }

        fragment UserFields on User {
          age
        }
      `;

      const client = new ApolloClient({ cache: new InMemoryCache() });
      const observableQuery = client.watchQuery({
        query,
        variables: { id: "1" },
      });

      expectTypeOf(observableQuery).toMatchTypeOf<
        ObservableQuery<Query, Variables>
      >();
      expectTypeOf(observableQuery).not.toMatchTypeOf<
        ObservableQuery<UnmaskedQuery, Variables>
      >();

      observableQuery.subscribe({
        next: (result) => {
          expectTypeOf(result.data).toMatchTypeOf<Query>();
          expectTypeOf(result.data).not.toMatchTypeOf<UnmaskedQuery>();
        },
      });

      expectTypeOf(observableQuery.getCurrentResult()).toMatchTypeOf<
        ApolloQueryResult<Query>
      >();
      expectTypeOf(observableQuery.getCurrentResult()).not.toMatchTypeOf<
        ApolloQueryResult<UnmaskedQuery>
      >();

      const fetchMoreResult = await observableQuery.fetchMore({
        updateQuery: (previousData, { fetchMoreResult }) => {
          expectTypeOf(previousData).toMatchTypeOf<UnmaskedQuery>();
          expectTypeOf(previousData).not.toMatchTypeOf<Query>();

          expectTypeOf(fetchMoreResult).toMatchTypeOf<UnmaskedQuery>();
          expectTypeOf(fetchMoreResult).not.toMatchTypeOf<Query>();

          return {} as UnmaskedQuery;
        },
      });

      expectTypeOf(fetchMoreResult.data).toMatchTypeOf<Query>();
      expectTypeOf(fetchMoreResult.data).not.toMatchTypeOf<UnmaskedQuery>();

      const refetchResult = await observableQuery.refetch();

      expectTypeOf(refetchResult.data).toMatchTypeOf<Query>();
      expectTypeOf(refetchResult.data).not.toMatchTypeOf<UnmaskedQuery>();

      const setVariablesResult = await observableQuery.setVariables({
        id: "2",
      });

      expectTypeOf(setVariablesResult?.data).toMatchTypeOf<Query | undefined>();
      expectTypeOf(setVariablesResult?.data).not.toMatchTypeOf<
        UnmaskedQuery | undefined
      >();

      const setOptionsResult = await observableQuery.setOptions({
        variables: { id: "2" },
      });

      expectTypeOf(setOptionsResult.data).toMatchTypeOf<Query | undefined>();
      expectTypeOf(setOptionsResult.data).not.toMatchTypeOf<
        UnmaskedQuery | undefined
      >();

      observableQuery.updateQuery(
        (_previousData, { complete, previousData }) => {
          expectTypeOf(_previousData).toEqualTypeOf<UnmaskedQuery>();
          expectTypeOf(_previousData).not.toMatchTypeOf<Query>();

          if (complete) {
            expectTypeOf(previousData).toEqualTypeOf<UnmaskedQuery>();
          } else {
            expectTypeOf(previousData).toEqualTypeOf<
              DeepPartial<UnmaskedQuery> | undefined
            >();
          }
        }
      );

      observableQuery.subscribeToMore({
        document: subscription,
        updateQuery(queryData, { subscriptionData, complete, previousData }) {
          expectTypeOf(queryData).toEqualTypeOf<UnmaskedQuery>();
          expectTypeOf(queryData).not.toMatchTypeOf<Query>();

          if (complete) {
            expectTypeOf(previousData).toEqualTypeOf<UnmaskedQuery>();
          } else {
            expectTypeOf(previousData).toEqualTypeOf<
              DeepPartial<UnmaskedQuery> | undefined
            >();
          }

          expectTypeOf(
            subscriptionData.data
          ).toMatchTypeOf<UnmaskedSubscription>();
          expectTypeOf(subscriptionData.data).not.toMatchTypeOf<Subscription>();
        },
      });
    });
  });
});
