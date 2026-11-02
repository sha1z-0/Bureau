# tracing (fork)

This fork fixes a span leak in tracing-subscriber when spans are dropped across await points.

I reproduced the leak with a failing test, traced it to a guard held across `.await`, and cut span memory in our worker from 1.2 GB to 140 MB over a day of traffic.

The fix was proposed upstream as a pull request.
