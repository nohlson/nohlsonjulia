@def title = "CPython Compiler Hardening Intro"
@def subtitle = "Getting to First PR"


I have been investigating adding default compiler and linker options to CPython for improved safety at runtime as well as uncover potential vulnerabilities by digging through warnings these compiler options would generate. OpenSSF has been developing some guidance for hardening compiler options and some time ago an [issue](https://github.com/python/cpython/issues/112301) was written suggesting CPython should consider adopting some of the suggestions of the OpenSSF and there is where I enter the story.

At first my goals are to

1. Get pyperformance baseline for existing CPython mainline
2. See how options suggested in the OpenSSF guidance affect benchmarks
3. Get an understanding of new warnings
4. Give a recommendation for a set of compiler options

For my local benchmarking machine I decided to install Fedora on a PC I built a few years ago. I chose Fedora because the Dockerfile that comes with the CPython repo specified a Fedora:40 image. The PC I will be using for benchmarking has an AMD Ryzen 7 3700X with 32GB of memory. I will use this machine as a way to gauge options to send on to run in a lab at Microsoft set up to run CPython benchmarks. More information on that [here](https://github.com/faster-cpython/benchmarking-public) and a special thanks to [Michael Droettboom](https://github.com/mdboom) for running these benchmarks!

At first I would like to figure out compiler options we can get for “free”. Warning flags that don’t generate any warnings and other compiler hardening options that have minimal impact on pyperformance benchmarks. These flags will be benchmarked on the Microsoft test machines and then if they are close to baseline benchmarks they will be included in a PR.

## Benchmarks

The OpenSSF [guidance document](https://github.com/ossf/wg-best-practices-os-developers/blob/main/docs/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C%2B%2B.md) provided a TLDR; set of compiler options for C/C++ code that the working group had deemed worthy enough that they should probably be enabled for a majority of projects. The first tests should be with these options:

```c
-O2 -Wall -Wformat -Wformat=2 -Wconversion -Wimplicit-fallthrough \
-Werror=format-security \
-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 \
-D_GLIBCXX_ASSERTIONS \
-fstrict-flex-arrays=3 \
-fstack-clash-protection -fstack-protector-strong \
-Wl,-z,nodlopen -Wl,-z,noexecstack \
-Wl,-z,relro -Wl,-z,now
```

Compiler and linker flags can be passed to the CPython configuration script. We know that the linker options are going to impact performance, so we will take benchmarks for each of the options we think are going to implement, observe the compile time warnings, and assess the benchmarks to get an initial PR of non-warning and non-performance impacting 

> Note: Benchmark numbering may not make much sense without more context. The intent is that these runs can be referenced in my backlog of benchmarks sometime in the future
> 

| Run Name | Configuration Command | Option |
| --- | --- | --- |
| Run 45 | ./configure CFLAGS="-O2 -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 46 | ./configure CFLAGS="-Wall -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 47 | ./configure CFLAGS="-Wformat=2 -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 48 | ./configure CFLAGS="-Wconversion -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 49 | ./configure CFLAGS="-Wimplicit-fallthrough -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 50 | ./configure CFLAGS="-Werror=format-security -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 51 | ./configure CFLAGS="-fstack-protector-strong -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 52 | ./configure CFLAGS="-fcf-protection=full -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 53 | ./configure CFLAGS="-Wtrampolines -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 54 | ./configure CFLAGS="-fno-delete-null-pointer-checks -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 55 | ./configure CFLAGS="-fno-strict-overflow -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 56 | ./configure CFLAGS="-fstrict-flex-arrays=1 -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 57 | ./configure CFLAGS="-fno-strict-aliasing -fdiagnostics-format=json" LDFLAGS="" |  |
| Run 58 | ./configure CFLAGS="-Wbidi-chars=any -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |
| Run 59 | ./configure | None (another baseline run for fun) |
| Run 60 | ./configure | None (yet another baseline run) |

Above run data is `run_set_20240618_011115`

## Results

By default CPython is compiled with `-O3` optimization, so `-O2` is not included, although it was tested here.

We can see that warnings are generated when some options are enabled:

| Run Name | New Warnings? |
| --- | --- |
| Run 45 | No |
| Run 46 | Yes |
| Run 47 | Yes (-Wformat-nonliterl) |
| Run 48 | Yes (-Wsign-conversion, -Wconversion, -Wfloat-conversion) |
| Run 49 | No |
| Run 50 | Yes |
| Run 51 | No |
| Run 52 | No |
| Run 53 | No |
| Run 54 | Yes (-Wformat-overflow replaces a -Wstringop-overflow) |
| Run 55 | No |
| Run 56 | No |
| Run 57 | No |
| Run 58 | No |
| Run 59 | N/A |
| Run 60 | N/A |

And an analysis of the benchmarks of the options that didn’t generate warnings (even just warning flags):

## Run 49 vs. Run 59

`-Wimplicit-fallthrough`

| Benchmark Tag | Geometric Mean |
| --- | --- |
| apps | 1.00x slower |
| asyncio | 1.01x slower |
| math | 1.00x faster |
| regex | 1.00x slower |
| serialize | 1.00x slower |
| startup | 1.00x slower |
| template | 1.01x slower |
| overall | 1.00x slower |

Just a warning flag. Including in next stage.

## Run 51 vs. Run 59

`-fstack-protector-strong`

| Benchmark Tag | Geometric Mean |
| --- | --- |
| apps | 1.01x slower |
| asyncio | 1.01x slower |
| math | 1.01x faster |
| regex | 1.01x faster |
| serialize | 1.02x slower |
| startup | 1.01x slower |
| template | 1.04x slower |
| overall | 1.01x slower |

A little suspicious but will include it in the set to be tested in the Microsoft lab.

## Run 53 vs. Run 59

`-Wtrampolines`

| Benchmark Tag | Geometric Mean |
| --- | --- |
| apps | 1.00x slower |
| asyncio | 1.01x slower |
| math | 1.00x faster |
| regex | 1.00x slower |
| serialize | 1.00x slower |
| startup | 1.00x slower |
| template | 1.01x slower |
| overall | 1.00x slower |

Looks good to move to next step.

## Run 55 vs. Run 59

`-fno-strict-overflow`

| Benchmark Tag | Geometric Mean |
| --- | --- |
| apps | 1.01x slower |
| asyncio | 1.01x slower |
| math | 1.00x faster |
| regex | 1.00x faster |
| serialize | 1.01x slower |
| startup | 1.00x slower |
| template | 1.01x slower |
| overall | 1.01x slower |

Looks good to include in next step.

# Benchmark in Microsoft Lab

I modified the CPython autoconf `configure.ac` to check and enable the options above:

```c
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-Wimplicit-fallthrough], [BASECFLAGS="$BASECFLAGS -Wimplicit-fallthrough"], [AC_MSG_WARN([-Wimplicit-fallthrough not supported])])
AX_CHECK_COMPILE_FLAG([-fstack-protector-strong], [BASECFLAGS="$BASECFLAGS -fstack-protector-strong"], [AC_MSG_WARN([-fstack-protector-strong not supported])])
AX_CHECK_COMPILE_FLAG([-fno-strict-overflow], [BASECFLAGS="$BASECFLAGS -fno-strict-overflow"], [AC_MSG_WARN([-fno-strict-overflow not supported])])
case $CC in
  *gcc*)
    # Add GCC-specific compiler flags          
    AX_CHECK_COMPILE_FLAG([-Wtrampolines], [BASECFLAGS="$BASECFLAGS -Wtrampolines"], [AC_MSG_WARN([-Wtrampolines not supported])])
esac
```

The benchmarks showed that the difference between my build and the baseline were below the threshold that we could reasonably measure.

### Base vs. New Options

- fork: nohlson
- ref: enable\_no\_impact\_def
- machine: linux-x86_64
- commit hash: 98d9ea0
- commit date: 2024-06-20
- overall geometric mean: 1.00x slower
- HPT reliability: 70.47%
- HPT 99th percentile: 1.00x faster
- Memory change: 1.00x

The full set of benchmarks can be found [here](https://github.com/faster-cpython/benchmarking-public/tree/main/results/bm-20240620-3.14.0a0-98d9ea0)

# Conclusion

I will create an initial PR with the following options since they do not negatively impact performance and do not generate new warnings at compile time:

```c
-Wimplicit-fallthrough -fstack-protector-strong -fno-strict-overflow -Wtrampolines
```

PR: [gh-112301: Enable compiler flags with low performance impact and no warnings #120975](https://github.com/python/cpython/pull/120975)

# UPDATE (6/25/24)

It was noted in the comments of the PR that `-fno-strict-overflow` is already enabled if it is available for the compiler. I removed my check and enabling of that flag since it is redundant.