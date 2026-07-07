@def title = "CPython Compiler Hardening"
@def subtitle = "Summer Retrospective"

This summer I contributed to the CPython project with the Python Software Foundation focusing on implementing hardened compiler options suggested by guidance recommended by the Open Source Software Foundation. After seeing this project on the list of Google Summer of Code options, I applied and was selected to contribute. In this piece I will outline the work done this summer to enable compiler options to make CPython safer, the tooling to track warnings these options generate, future plans to address existing warnings, and lessons learned along the way.

In late 2023 it came to the attention of some CPython core developers that the OpenSSF’s Memory Safety Special Interest Group had been developing [a guide](https://github.com/ossf/wg-best-practices-os-developers/blob/main/docs/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.md) for delivering secure C and C++ code by enabling compiler and linker options. The guide outlines the motivation for using compiler hardening options and provides a set of recommended compiler options that should generally be enabled when building a C/C++ project. Using strong compiler options is important to creating safe software because they can warn developers of potential vulnerabilities at compile time as well as include run-time protections in the resulting binary. [An issue was opened on CPython’s GitHub repo](https://github.com/python/cpython/issues/112301) suggesting that CPython could benefit from considering of the suggestions of the OpenSSF Memory Safety SIG and applying them to CPython’s build process. Some of the key takeaways from the initial discussion in the issue were:

- Using the recommended options from the guide generates a lot of warnings in the existing CPython codebase.
- Performance impacts of options that enable runtime protections should be considered.
- If the options were going to be enabled tooling should be implemented to track these warnings and aid in keeping new warnings from being introduced.
- There should be an effort to address existing warnings uncovered by the options we choose to enable.

This issue was proposed as a Google Summer of Code project and after applying I was chosen to be a contributor!

# Picking an Initial Set of Options

The OpenSSF guide provides an initial TL;DR set of compiler options intended to be a good starting point for developers endeavoring on the journey of hardening their programs. Initially I was going to do some testing on a development machine I had stood up running Fedora 40 x86_64 with GCC. The TL;DR options are:

```bash
-O2 -Wall -Wformat -Wformat=2 -Wconversion -Wimplicit-fallthrough \
-Werror=format-security \
-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 \
-D_GLIBCXX_ASSERTIONS \
-fstrict-flex-arrays=3 \
-fstack-clash-protection -fstack-protector-strong \
-Wl,-z,nodlopen -Wl,-z,noexecstack \
-Wl,-z,relro -Wl,-z,now
```

After splitting these up into compiler and linker flags, and including some GCC specific options addressed in the TL;DR section of the guide like `-Wtrampolines`, I passed them as options to the CPython configure script

```bash
./configure \
CFLAGS="-O2 -Wall -Wformat=2 -Wconversion \
				-Wtrampolines -Wimplicit-fallthrough \
				-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 \
				-D_GLIBCXX_ASSERTIONS -fstrict-flex-arrays=3 \
				-fstack-clash-protection -fstack-protector-strong \
				-fcf-protection=full -fPIC" \
CPPFLAGS="-D_GLIBCXX_ASSERTIONS" \
LDFLAGS="-Wl,-z,nodlopen -Wl,-z,noexecstack -Wl,-z,relro -Wl,-z -pie"
```

And after building

```bash
$ make -j8
```

I had a `python` binary and a terminal flooded with warnings. To aid in parsing these warnings I discovered that GCC had an option to output diagnostics in JSON format, and I decided that this would make extracting warnings a bit easier via script. The initial warning count was

| Warning Option | Count |
| --- | --- |
| -Wsign-conversion | 4418 |
| -Wconversion | 2004 |
| -Warray-bounds= | 314 |
| -Wformat-nonliteral | 12 |
| -Wstringop-overflow= | 4 |
| -Wfloat-conversion | 3 |
| -Wstringop-overread | 1 |
| Total | 6756 |

Now I wanted to run a benchmark using `pyperformance` on my local machine. I spent some time trying to set up my development machine to produce stable benchmarks, which is a long story that I will touch on a little later on. In short, I eventually had to rely on running benchmarks with [faster-cpython](https://github.com/faster-cpython) as they have a dedicated lab for running `pyperformance` that was generating reliably stable benchmarks. For now running on my local machine was simply going to be a preliminary test before requesting time in the faster-cpython lab.

On my machine the `pyperformance` benchmark immediately fails to even run with this configuration

```bash
Traceback (most recent call last):
  File "/home/nate/cpython/Lib/runpy.py", line 198, in _run_module_as_main
    return _run_code(code, main_globals, None,
                     "__main__", mod_spec)
  File "/home/nate/cpython/Lib/runpy.py", line 88, in _run_code
    exec(code, run_globals)
    ~~~~^^^^^^^^^^^^^^^^^^^
  File "/home/nate/.local/lib/python3.14/site-packages/pyperformance/__main__.py", line 1, in <module>
    import pyperformance.cli
  File "/home/nate/.local/lib/python3.14/site-packages/pyperformance/cli.py", line 6, in <module>
    from pyperformance import _utils, is_installed, is_dev
  File "/home/nate/.local/lib/python3.14/site-packages/pyperformance/_utils.py", line 28, in <module>
    import tempfile
  File "/home/nate/cpython/Lib/tempfile.py", line 45, in <module>
    from random import Random as _Random
  File "/home/nate/cpython/Lib/random.py", line 53, in <module>
    from math import log as _log, exp as _exp, pi as _pi, e as _e, ceil as _ceil
ModuleNotFoundError: No module named 'math'
```

After some investigation it became clear that disallowing `dlopen()` with `-WL,-z,nodlopen` was not going to be possible for a project like CPython where `dlopen()` is used to load modules. 

> Lesson Learned: For a large project like CPython not all of the TL;DR options are going to work. It’s an OK first step to dive in, build with the options, run your test suite, and see what happens.
> 

I decided to tweak the options I would include in my configuration to remove `nodlopen` as well as remove `-fstrict-flex-arrays=3` since it was noted in the [original CPython issue](https://github.com/python/cpython/issues/112301#issuecomment-1821816605) that, at least for now, this level of strict flex arrays couldn’t be included in CPython but I considered [level 1](https://github.com/ossf/wg-best-practices-os-developers/blob/main/docs/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.md#enable-strict-flexible-arrays) might be feasible. Also removed were the “additional” options not directly included in the TL;DR.

The new configuration was

```bash
 ./configure CFLAGS="-O2 -Wall -Wformat=2 -Wconversion \
 -Wimplicit-fallthrough -Werror=format-security -U_FORTIFY_SOURCE \
 -D_FORTIFY_SOURCE=3 -D_GLIBCXX_ASSERTIONS -fstack-clash-protection \
 -fstack-protector-strong -fcf-protection=full -fdiagnostics-format=json" \
 LDFLAGS="-Wl,-z,noexecstack -Wl,-z,relro -Wl,-z,now"
```

This allowed me to get a(n unstable) benchmark on my local machine which along with a run of the unit tests gave some confidence that CPython built successfully. The warnings were

| Warning Type | Count |
| --- | --- |
| -Wsign-conversion | 4511 |
| -Wconversion | 2028 |
| -Wformat-nonliteral | 12 |
| -Wfloat-conversion | 3 |
| Total | 6554 |

It was noted out in the initial issue that since many files are compiled multiple times, the warnings will appear in the output multiple times. After removing duplicates based on warning, filename, line number, and column I was able to reduce the list to only the unique warnings:

| Warning Type | Count |
| --- | --- |
| -Wsign-conversion | 2567 |
| -Wconversion | 983 |
| -Wformat-nonliteral | 12 |
| -Wfloat-conversion | 3 |
| Total | 3565 |

The OpenSSF guide breaks down options into those that generate run-time protections that would theoretically impact performance and those that do not, which are generally just warning flags. This is the breakdown for the current selection of options:

CFLAGS

| Option | Performance Impact |
| --- | --- |
| -O2 | Yes |
| -Wall | No |
| -Wformat=2 | No |
| -Wconversion | No |
| -Wimplicit-fallthrough | No |
| -Werror=format-security | No |
| -U_FORTIFY_SOURCE | Yes |
| -D_FORITIFY_SOURCE | Yes |
| -D_GLIBCXX_ASSERTIONS | Yes |
| -fstack-clash-protection | Yes |
| -fstack-protector-strong | Yes |
| -fcf-protection-full | Yes |
| -fdiagnostics-format=json | No |

LDFLAGS

| Option | Performance Impact |
| --- | --- |
| -Wl,-z,noexecstack | Yes |
| -Wl,-z,relro | Yes |
| -Wl,-z,now | Yes |

And the other options that I was then considering adding to the list to test:

| Option | Impacts performance? |
| --- | --- |
| -Wtrampolines | No |
| -Wbidi-chars=any | No |
| -fstrict-flex-arrays=1 | No |
| -fno-delete-null-pointer-checks | No |
| -fno-strict-overflow | No |
| -fno-strict-aliasing | No |
| -fexceptions | Yes larger binary |

# Benchmarks

The set of options that would not impact performance was known, what was not known was how much the run-time protection production options were going to impact `pyperformance` benchmarks.

I will take a moment to address something I alluded to earlier, which is the instability of the benchmarks I ran on my own machine. Over the course of this project I ran nearly 100 different benchmarks. These benchmarks would be different combinations of compiler options to see how they might impact performance when paired with other options. Typically I would script a nightly run that would include a baseline no-option benchmark paired with a dozen or so other benchmarks. The machine I ran it on had a clean Fedora 40 install on bare-metal with its own dedicated M.2 drive, AMD Ryzen 7 3700X, and 32 GB of memory. Before each nightly run I would reboot the machine to hopefully start from the same state. I had tuned the system using [pyperf system tune](https://pyperf.readthedocs.io/en/latest/run_benchmark.html#how-to-get-reproducible-benchmark-results). Even though I expected to gain insights by comparing benchmarks to the baseline benchmark within each group, re-running the same set of benchmarks sometimes led to different conclusions about the performance impact of a particular option. Even running the baseline no-option benchmark twice would lead to performance diffs that were not negligible. After reading [documentation](https://pyperf.readthedocs.io/en/latest/run_benchmark.html#how-to-get-reproducible-benchmark-results) and [forums](https://discuss.python.org/t/python-benchmarking-in-unstable-environments/22334/5) I realized that I could end up spending way too much time chasing this issue. Luckily Michael Droettboom informed me about `faster-cpython` and the dedicated lab that was available for benchmarking. This allowed me to get reliable benchmarks, and without it there would be much more skepticism about run-time protection options going into CPython mainline. Thank you Michael!

The first benchmark ran on `faster-cpython` included all of the options that successfully completed the benchmark tests on my local machine. I sent over a branch with compiler options appended to the CFLAGS list in CPython’s autoconf file:

```bash
AS_VAR_APPEND([CFLAGS], ["-O2 -Wall -Wformat=2 -Wconversion -Wimplicit-fallthrough \
-Werror=format-security -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 -D_GLIBCXX_ASSERTIONS \
-fstack-clash-protection -fstack-protector-strong -fcf-protection=full -Wtrampolines \
-fno-delete-null-pointer-checks -fno-strict-overflow \
-fno-strict-aliasing -fdiagnostics-format=json"])
AS_VAR_APPEND([LDFLAGS], ["-Wl,-z,noexecstack -Wl,-z,relro -Wl,-z,now"])
```

Now, this is not the way to include compiler options in a project that is cross-compiled and built for many platforms. If any of these options are unavailable on the target platform, the build will simply fail. Eventually would include compiler options using autoconf macros, but it did prove to front load the issue of options I wanted to benchmark not being enabled by failing the build in the `faster-cpython` lab as opposed to receiving a benchmark and retroactively parsing the build artifacts (we eventually discovered that `-Wtrampolines` and `-fstrict-flex-arrays=1` were not supported in the `faster-cpython` lab in this way).

[The benchmark showed](https://github.com/faster-cpython/benchmarking-public/blob/main/results/bm-20240618-3.14.0a0-5b8a44e/bm-20240618-linux-x86_64-nohlson-1_investigate_compil-3.14.0a0-5b8a44e-vs-base.md):

- overall geometric mean: 1.01x faster
- HPT reliability: 100.00%
- HPT 99th percentile: 1.00x faster
- Memory change: 1.00x

| Tag | Geometric Mean |
| --- | --- |
| apps | 1.01x faster |
| asyncio | no impact |
| math | 1.02x faster |
| regex | 1.03x slower |
| serialize | 1.00x faster |
| startup | 1.00x slower |
| template | 1.01x faster |
| overall | 1.01x faster |

The details of each of the benchmarks ran are worth looking into but the general overview shows that we probably shouldn’t expect performance impacts with this set of options.

# First PR

The intent of the [first PR](https://github.com/python/cpython/pull/120975) was to introduce warning options that didn’t generate warnings and run-time protection options that didn’t impact performance, as a proof of concept. The warning options I picked were based on options that didn’t generate warnings on my own machine. These options were:

- `-Wimplicit-fallthrough`
- `-Wtrampolines`

And the run-time protection options were

- `-fstack-protector-strong`
- `-fno-strict-overflow`

They were included in the autoconf as

```bash
AX_CHECK_COMPILE_FLAG([-Wimplicit-fallthrough], [BASECFLAGS="$BASECFLAGS -Wimplicit-fallthrough"], [AC_MSG_WARN([-Wimplicit-fallthrough not supported])])
AX_CHECK_COMPILE_FLAG([-fstack-protector-strong], [BASECFLAGS="$BASECFLAGS -fstack-protector-strong"], [AC_MSG_WARN([-fstack-protector-strong not supported])])
AX_CHECK_COMPILE_FLAG([-fno-strict-overflow], [BASECFLAGS="$BASECFLAGS -fno-strict-overflow"], [AC_MSG_WARN([-fno-strict-overflow not supported])])
case $CC in
  *gcc*)
    # Add GCC-specific compiler flags          
    AX_CHECK_COMPILE_FLAG([-Wtrampolines], [BASECFLAGS="$BASECFLAGS -Wtrampolines"], [AC_MSG_WARN([-Wtrampolines not supported])])
esac
```

It was noted in the PR that `-fno-strict-overflow` was redundant, so it was removed before the change was merged.

`-Wtrampolines` had a special wrapper since it was known to be GCC-only and GCC versions without it should be fine due to the compile flag check generated by autoconf, right? The PR was merged and immediately there were issues. CPython has an army of buildbots that build and run the unit test suite post-merge and the macOS buildbot was failing to build:

![image.png](/assets/blog_images/Screenshot_2024-06-26_at_1.17.19_AM.png)

Turns out `gcc` on macOS is a wrapper for `clang` and `-Wtrampolines` was causing the build to fail. But wouldn’t the compiler check made by autoconf preclude it from making it into the final list of flags? After finding a useful Stack Overflow thread it turns out that in the compiler flag check clang will emit a warning about the unknown option. The configure script saw macOS was using gcc (clang underneath) and tried `-Wtrampolines` and when only a warning was emitted it was included in `BASEFLAGS`. This was a good lesson to learn, it meant that going forward new options should use an additional argument for the `AX_CHECK_COMPILER_FLAG` autoconf macro for “additional flags”. That flag should be `-Werror` so that when configured all unavailable options will be skipped.

Another issue was that warnings were in fact being generated by the buildbots. These warnings were related to `-Wimplicit-fallthrough` and only on clang buildbots. Turns out clang would flag certain un-annotated fallthrough cases as warnings that gcc would not. This became a huge motivator to create platform specific tooling for tracking warnings.

## A Home For Options

There are a few variables within CPython’s configuration script where compiler options could be added including `CFLAGS` and `BASEFLAGS`. Initially, somewhat naively, I added options to `BASEFLAGS` since these are universal options we want applied across the project. [It was mentioned](https://github.com/python/cpython/issues/112301#issuecomment-2238383942) that `BASEFLAGS` are used by `sysconfig` and reused by other tools. Using `CFLAGS_NODIST` within the configure script for new options would limit the scope of the compiler options to CPython itself, which is more inline with the intent of this project. Adding flags to `CFLAGS_NODIST` looks like this

```c
AX_CHECK_COMPILE_FLAG([-D_FORTIFY_SOURCE=3], [CFLAGS_NODIST="$CFLAGS_NODIST -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3"], [AC_MSG_WARN([-D_FORTIFY_SOURCE=3 not supported])], [-Werror])
```

> Lesson Learned: It is important to properly consider the scope of new compiler options. In large projects there could be unintended downstream effects that might not be immediately obvious in benchmarks, CI, or unit tests.
> 

# Warning Tooling

In the CPython CI toolchain there had already existed warning checking for documentation builds. This would be the basis for compiler warning checking and so I derived a few requirements from looking over how this was done for docs.

The tooling should have:

- The ability to track regressions (more than expected warnings)
- The ability to track improvements (instances where a change reduced warnings)
- The ability to choose if the workflow would fail silently or fail the pipeline easily
- The ability to identify files where warnings would be ignored

The warning check tooling for docs was integrated into a dedicated [GitHub actions workflow called for building and testing the docs](https://github.com/python/cpython/actions/runs/10288475708/job/28474011930?pr=122758). This tooling benefitted from the fact that warnings emitted are platform independent, and therefore only needed to be tested once in an Ubuntu-based workflow. Initially I had considered rolling compiler warning checking into the army of [CPython buildbots](https://devguide.python.org/testing/buildbots/index.html) in order to test as many platforms as possible, but it soon became apparent that this strategy would be overkill for our needs. The compute available to the buildbots is limited and in the worst case a manifest of warnings to ignore would have to be generated for each build. I decided a better approach would be to integrate it into GitHub Actions and target two platforms, Ubuntu with GCC and macOS with clang. In CPython CI these workflows are called Ubuntu/build and test and macOS/build and test.

To test GitHub Actions locally I installed [act](https://github.com/nektos/act) on my development machine which uses Docker to build images based on your workflow configuration in `.github/workflows`. This allowed me to get much quicker feedback and to keep a much cleaner git history since I could avoid pushing commits to GitHub to test. CPython had an existing configuration `.github/workflows/reusable-ubuntu.yml` that was a template for creating Ubuntu-based workflows. There are a few OpenSSL related tests that start off this workflow but  toward the end it builds CPython and runs the unit tests

```yaml
    - name: Configure CPython out-of-tree
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: ${{ inputs.options }}
    - name: Build CPython out-of-tree
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: make -j4
    - name: Display build info
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: make pythoninfo
    - name: Remount sources writable for tests
      # some tests write to srcdir, lack of pyc files slows down testing
      run: sudo mount $CPYTHON_RO_SRCDIR -oremount,rw
    - name: Tests
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: xvfb-run make test
```

Warning checking should fit nicely after the build and before the tests

Output parsing and warning analysis will be done in a new script `Tools/build/check_warnings.py` . We will take a look at some of the components, which evolved over time, but for the sake of brevity I will share the implementation as it exists today as the script itself is rather trivial.

I already had some scripts that I had been using to parse the JSON compiler output from GCC using `-fdiagnostics-format=json` so I was going to leverage that in `check_warnings.py`

```python
def extract_warnings_from_compiler_output_json(
    compiler_output: str,
    path_prefix: str = "",
) -> list[dict]:
    """
    Extracts warnings from the compiler output when using
    -fdiagnostics-format=json.

    Compiler output as a whole is not a valid json document,
    but includes many json objects and may include other output
    that is not json.
    """
    # Regex to find json arrays at the top level of the file
    # in the compiler output
    json_arrays = re.findall(r"\[(?:[^[\]]|\[[^]]*])*]", compiler_output)
    compiler_warnings = []
    for array in json_arrays:
        try:
            json_data = json.loads(array)
            json_objects_in_array = [entry for entry in json_data]
            warning_list = [
                entry
                for entry in json_objects_in_array
                if entry.get("kind") == "warning"
            ]
            for warning in warning_list:
                locations = warning["locations"]
                for location in locations:
                    for key in ["caret", "start", "end"]:
                        if key in location:
                            compiler_warnings.append(
                                {
                                    # Remove leading current
                                    # directory if present
                                    "file": location[key]["file"].removeprefix(
                                        path_prefix
                                    ),
                                    "line": location[key]["line"],
                                    "column": location[key]["column"],
                                    "message": warning["message"],
                                    "option": warning["option"],
                                }
                            )
                            # Found a caret, start, or end in location so
                            # break out completely to address next warning
                            break
                    else:
                        continue
                    break

        except json.JSONDecodeError:
            continue  # Skip malformed JSON

    return compiler_warnings
```

A regex captures JSON arrays from the compiler output. Sometimes the regex captures output that looks like a JSON array based on the bracket structure, so to discard those we just let `json.loads()` throw an exception and then continue to the next potential JSON array. If the captured output is a valid JSON array then we extract the warnings and build a new list where each item in the list is a dictionary containing information about the warning necessary for further processing.

Capturing warnings emitted by clang for macOS jobs is done in the same way, just without parsing JSON.

```python
def extract_warnings_from_compiler_output_clang(
    compiler_output: str,
    path_prefix: str = "",
) -> list[dict]:
    """
    Extracts warnings from the compiler output when using clang
    """
    # Regex to find warnings in the compiler output
    clang_warning_regex = re.compile(
        r"(?P<file>.*):(?P<line>\d+):(?P<column>\d+): warning: "
        r"(?P<message>.*) (?P<option>\[-[^\]]+\])$"
    )
    compiler_warnings = []
    for line in compiler_output.splitlines():
        if match := clang_warning_regex.match(line):
            compiler_warnings.append(
                {
                    "file": match.group("file").removeprefix(path_prefix),
                    "line": match.group("line"),
                    "column": match.group("column"),
                    "message": match.group("message"),
                    "option": match.group("option").lstrip("[").rstrip("]"),
                }
            )
```

The docs warning check tooling used a `.warningignore` file to catalog source files that would be ignored by the tooling. The file contained paths to files from the CPython root directory separated by newlines. This was adopted for the compiler warnings but additionally we will track the number of warnings emitted per file.

```bash
# Files listed will be ignored by the compiler warning checker
# for the Ubuntu/build and test job.
# Keep lines sorted lexicographically to help avoid merge conflicts.
# Format example:
# /path/to/file (number of warnings in file)
Include/internal/mimalloc/mimalloc/internal.h 4
Include/internal/pycore_backoff.h 3
Include/internal/pycore_blocks_output_buffer.h 2
Include/internal/pycore_dict.h 2
Include/internal/pycore_gc.h 1
Include/internal/pycore_gc.h 1
Include/internal/pycore_list.h 1
Include/internal/pycore_long.h 3
Include/internal/pycore_object.h 3
Modules/_asynciomodule.c 3
Modules/_bisectmodule.c 4
```

Once warnings are gathered from the compiler output, whether it be GCC or clang duplicate warnings need to be removed and the remaining unique warnings should be put in a data structure where they can be accessed via filename to easily compare warnings emitted by a file with an entry in the warning ignore file.

```python
def get_warnings_by_file(warnings: list[dict]) -> dict[str, list[dict]]:
    """
    Returns a dictionary where the key is the file and the data is the
    warnings in that file. Does not include duplicate warnings for a
    file from list of provided warnings.
    """
    warnings_by_file = defaultdict(list)
    warnings_added = set()
    for warning in warnings:
        warning_key = (
            f"{warning['file']}-{warning['line']}-"
            f"{warning['column']}-{warning['option']}"
        )
        if warning_key not in warnings_added:
            warnings_added.add(warning_key)
            warnings_by_file[warning["file"]].append(warning)

    return warnings_by_file
```

This list of warnings is then cross checked with the data extracted from the warning ignore file. The script has two arguments for `--fail-on-regression` and `--fail-on-improvement` so that the tooling can either allow workflows to pass while still logging warnings for developers to see in the CI artifacts or to fail the workflow completely and force developers to address the discrepancy. Additional arguments to specify the type the compiler output `gcc` or `clang` and to specify a path prefix that the tool will remove when parsing compiler output.

Compiler output:

```python
{"kind": "warning", "locations": [{"finish": {"byte-column": 69, "display-column": 69, "line": 3577, "file": "../cpython-ro-srcdir/Modules/_elementtree.c", "column": 69}, "caret": {"byte-column": 53, "display-column": 53, "line": 3577, "file": "../cpython-ro-srcdir/Modules/_elementtree.c", "column": 53}}], "column-origin": 1, "option": "-Wsign-conversion", "children": [], "option_url": "https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wsign-conversion", "message": "conversion to ‘Py_ssize_t’ {aka ‘long int’} from ‘size_t’ {aka ‘long unsigned int’} may change the sign of the result"}
```

File path extracted:

```python
../cpython-ro-srcdir/Modules/_elementtree.c
```

File path with `--path-prefix="../cpython-ro-srcdir"`

```python
Modules/_elementtree.c
```

I included the script as a step in `reusable-ubuntu.yml` and `reusable-macos.yml` . This is how it fits in `reusable-ubuntu.yml`:

```python
    - name: Build CPython out-of-tree
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: set -o pipefail; make -j4 2>&1 | tee compiler_output.txt
    - name: Display build info
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: make pythoninfo
    - name: Check compiler warnings
      run: >-
        python Tools/build/check_warnings.py
        --compiler-output-file-path=${{ env.CPYTHON_BUILDDIR }}/compiler_output_ubuntu.txt
        --warning-ignore-file-path ${GITHUB_WORKSPACE}/Tools/build/.warningignore_ubuntu
        --compiler-output-type=json
        --fail-on-regression
        --fail-on-improvement
        --path-prefix="../cpython-ro-srcdir/"
    - name: Remount sources writable for tests
      # some tests write to srcdir, lack of pyc files slows down testing
      run: sudo mount $CPYTHON_RO_SRCDIR -oremount,rw
    - name: Tests
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: xvfb-run make test
```

## Pulling in the Tool

The plan was to introduce the tooling piecewise. Initially the tool would be integrated into CPython CI with no change in build flags (therefore no warnings). This means we can leave the warning ignore files empty and leave fail on regression and fail on improvement turned off. [A PR was created](https://github.com/python/cpython/pull/121730) that implemented gcc parsing and integration into the Ubuntu build and test workflows and later [one for macOS](https://github.com/python/cpython/pull/122211). Testing locally using `act` on my Fedora machine for the Ubuntu workflow and on my Macbook for macOS workflows with warning generating compiler options enabled was successful. The next step was to introduce several compiler options that generated warnings, pull all of those files and warning counts into the warning ignore files, and enable `--fail-on-regression` and `--fail-on-improvement`. These changes would immediatly slow the introduction of new warnings. At least when developers now introduce new warnings they will have no choice but to either refactor to remove the warnings or to ignore the warning in the warning ignore configuration whereas previously the number of warnings could grow without bound and most likely without the developer being aware. The warning compiler options are

```bash
  AX_CHECK_COMPILE_FLAG([-Wconversion], [CFLAGS_NODIST="$CFLAGS_NODIST -Wconversion"], [AC_MSG_WARN([-Wconversion not supported])], [-Werror])
  AX_CHECK_COMPILE_FLAG([-Wimplicit-fallthrough], [CFLAGS_NODIST="$CFLAGS_NODIST -Wimplicit-fallthrough"], [AC_MSG_WARN([-Wimplicit-fallthrough not supported])], [-Werror])
  AX_CHECK_COMPILE_FLAG([-Werror=format-security], [CFLAGS_NODIST="$CFLAGS_NODIST -Werror=format-security"], [AC_MSG_WARN([-Werror=format-security not supported])], [-Werror])
  AX_CHECK_COMPILE_FLAG([-Wbidi-chars=any], [CFLAGS_NODIST="$CFLAGS_NODIST -Wbidi-chars=any"], [AC_MSG_WARN([-Wbidi-chars=any not supported])], [-Werror])
  AX_CHECK_COMPILE_FLAG([-Wall], [CFLAGS_NODIST="$CFLAGS_NODIST -Wall"], [AC_MSG_WARN([-Wall not supported])], [-Werror])
```

These generated a considerable amount of warnings.

| Platform | Warning Count |
| --- | --- |
| Ubuntu | 3349 |
| macOS | 2854 |

The warning ignore files were updated accordingly. The idea is to allow the tooling to start limiting the number of new warnings that were being introduced without having to address all the existing warnings in the codebase. [I updated the Python Developer’s Guide](https://devguide.python.org/development-tools/warnings/) to include information for developers about the tool and steps to take to remediate a failing workflow.

However issues started to arise once the workflows with these new updates were running on GitHub.

## Tooling Failing with a Different Set of Warnings

I noticed that for both Ubuntu and macOS workflows running on GitHub new unexpected warnings were being flagged by the tooling as well as some unexpected improvements. To check if these were legitimate warnings I downloaded the artifacts from the failed workflow and ran the compiler output through `warning_check.py` on my local machine. The script did not find any discrepancies when compared with the existing warning ignore files. I was surprised at the idea that the issue could be in the tool itself and “it works on my machine”. I took a look at all of the workflows that use `reusable-ubuntu.yml` and `reusable-macos.yml`:

`reusable-ubuntu.yml`

- Ubuntu/build and test
- Ubuntu (free-threading)/build and test

`resuable-macos.yml`

- macOS/build and test (macos-13)
- macOS/build and test (ghcr.io/cirruslabs/macos-runner:sonoma**)**
- macOS (free-threading)/build and test (ghcr.io/cirruslabs/macos-runner:sonoma**)**

It makes sense that the free-threading build of CPython would generate different warnings from the normal GIL version as there are many sections of code that are pre-process selected for each version, so seeing that build fail with warning ignore set from a different job compiler output is not surprising. I decided to check to see if some of the unexpected warnings that were showing up in one workflows tooling were in the raw compiler output of another workflow that used the same `reusable-*` configuration i.e. free-threading compiler warnings in non-free-threading jobs warning check tooling output. Sure enough they did.

The individual workflows are spawned at the top level `build.yml` main GitHub actions configuration by using a matrix strategy

```bash
  build_ubuntu:
    name: >-
      Ubuntu
      ${{ fromJSON(matrix.free-threading) && '(free-threading)' || '' }}
    needs: check_source
    if: needs.check_source.outputs.run_tests == 'true'
    strategy:
      matrix:
        free-threading:
        - false
        - true
```

```bash
  build_macos:
    name: >-
      macOS
      ${{ fromJSON(matrix.free-threading) && '(free-threading)' || '' }}
    needs: check_source
    if: needs.check_source.outputs.run_tests == 'true'
    strategy:
      fail-fast: false
      matrix:
        # Cirrus and macos-14 are M1, macos-13 is default GHA Intel.
        # macOS 13 only runs tests against the GIL-enabled CPython.
        # Cirrus used for upstream, macos-14 for forks.
        os:
        - ghcr.io/cirruslabs/macos-runner:sonoma
        - macos-14
        - macos-13
```

It seems that within these `build_*` jobs the filesystem is preserved. This was causing a race condition for the `compiler_output.txt` that was being written to by different builds.

```bash
    - name: Build CPython out-of-tree
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: set -o pipefail; make -j4 2>&1 | tee compiler_output.txt
```

I decided that it was best to focus on the non-free-threading builds and only a single workflow for Ubuntu and macOS.

The configuration for `reusable-ubuntu.yml` was updated to only write compiler output to a file for non-free-threading builds

```bash
    - name: Build CPython out-of-tree
      if: ${{ inputs.free-threading }}
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: make -j4
    - name: Build CPython out-of-tree (for compiler warning check)
      if: ${{ !inputs.free-threading}}
      working-directory: ${{ env.CPYTHON_BUILDDIR }}
      run: set -o pipefail; make -j4 2>&1 | tee compiler_output_ubuntu.txt
```

And only for non-free-threading macOS-13 builds in `reusable-macos.yml`

```bash
   - name: Build CPython
      if : ${{ inputs.free-threading || inputs.os != 'macos-13' }}
      run: gmake -j8
    - name: Build CPython for compiler warning check
      if : ${{ !inputs.free-threading && inputs.os == 'macos-13' }}
      run: set -o pipefail; make -j8 2>&1 | tee compiler_output_macos.txt
```

The warning check tooling was then getting the compiler output meant for it.

## macOS Jumbled Compiler Output

Despite removing the race condition for writing to the compiler output file the macOS build still failed the warning check finding some bizarre file paths

```bash
{'file': '        ~ ^~~~~~~~~~~~~~~~~~~~~~~~~~~./Modules/resource.c', 'line': '173', 'column': '24', 'message': "implicit conversion changes signedness: 'long' to 'rlim_t' (aka 'unsigned long long')", 'option': '-Wsign-conversion'}
{'file': './Modules/socketmodule.c./Include/internal/mimalloc/mimalloc/internal.h', 'line': '814', 'column': '10', 'message': "implicit conversion changes signedness: 'int' to 'size_t' (aka 'unsigned long')", 'option': '-Wsign-conversion'}
```

Taking a look at the raw compiler output they were in fact jumbled

```bash
In file included from ./Include/internal/pycore_object_deferred.h:8:
./Include/internal/pycore_gc.h:230:21: warning: implicit conversion changes signedness: 'int' to 'uintptr_t' (aka 'unsigned long') [-Wsign-conversion]
    gc->_gc_prev &= ~_PyGC_PREV_MASK_FINALIZED;
                 ~~ ^~~~~~~~~~~~~~~~~~~~~~~~~~
Objects/descrobject.c:382:42: warning: implicit conversion changes signedness: 'Py_ssize_t' (aka 'long') to 'size_t' (aka 'unsigned long') [-Wsign-conversion]
                            args+1, nargs-1, kwnames);
                                    ~~~~~^~
In file included from Objects/exceptions.c:Objects/descrobject.c:509:48: warning: implicit conversion changes signedness: 'Py_ssize_t' (aka 'long') to 'size_t' (aka 'unsigned long') [-Wsign-conversion]
In file included from Objects/enumobject.c:                                           argc-1, kwds);4
:
                                           ~~~~^~
```

The macOS workflow used 8 threads to build

```bash
    - name: Build CPython for compiler warning check
      if : ${{ !inputs.free-threading && inputs.os == 'macos-13' }}
      run: set -o pipefail; gmake -j8 2>&1 | tee compiler_output_macos.txt
```

And dropping this down to 1 did solve the issue, but Seth Larson pointed out to me that GNU make [has an argument](https://www.gnu.org/software/make/manual/html_node/Parallel-Output.html) to synchronize make job output `--output-sync` that would solve the issue. The system `make` available on macOS and in the workflow is BSD make, which doesn’t have `--output-sync` so to remedy this in the workflow configuration I used `homebrew` to install GNU make

```bash
    - name: Install Homebrew dependencies
      run: brew install pkg-config openssl@3.0 xz gdbm tcl-tk make
```

and use `gmake` instead

```bash
    - name: Build CPython for compiler warning check
      if : ${{ !inputs.free-threading && inputs.os == 'macos-13' }}
      run: set -o pipefail; gmake -j8 --output-sync 2>&1 | tee compiler_output_macos.txt
```

# Continuing Work

### Addressing Existing Warnings

Once the warning generating compiler options and the proper ignore configuration [PR](https://github.com/python/cpython/pull/123020) merges we can begin the process of addressing the thousands of existing warnings in the existing codebase. I would like to develop a process for analyzing each file in the long warning ignore lists and systematically fixing these warnings, or documenting why there is not a vulnerability and why we are not going to refactor. An example of how this process might work is in  a separate [PR I opened](https://github.com/python/cpython/pull/122474) that enables a compiler option that only generates a dozen or so warnings in two files. The option is `-Wformat=2` and the warnings generated are instances where non-literal format strings are used in `sprintf` type functions.

```bash
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2857, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2857, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2858, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2858, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2862, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2862, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2863, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2863, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2867, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2867, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2868, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2868, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 19, 'display-column': 19, 'line': 2871, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 19}, 'caret': {'byte-column': 17, 'display-column': 17, 'line': 2871, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 17}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2875, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2875, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2876, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2876, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2880, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2880, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 27, 'display-column': 27, 'line': 2881, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 27}, 'caret': {'byte-column': 21, 'display-column': 21, 'line': 2881, 'file': '../cpython-ro-srcdir/Objects/unicodeobject.c', 'column': 21}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
| {'kind': 'warning', 'locations': [{'finish': {'byte-column': 28, 'display-column': 28, 'line': 23, 'file': '../cpython-ro-srcdir/Python/getversion.c', 'column': 28}, 'caret': {'byte-column': 19, 'display-column': 19, 'line': 23, 'file': '../cpython-ro-srcdir/Python/getversion.c', 'column': 19}}], 'column-origin': 1, 'option': '-Wformat-nonliteral', 'children': [], 'option_url': 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html#index-Wformat-nonliteral', 'message': 'format not a string literal, argument types not checked'}
```

This output from the warning check tool exemplifies how the tool will fail on regression, however instead of throwing these in the warning ignore files we can eliminate warnings at the source. In this example `getversion.c` simply builds a formatted version string

```bash

void _Py_InitVersion(void)
{
    if (initialized) {
        return;
    }
    initialized = 1;
#ifdef Py_GIL_DISABLED
    const char *buildinfo_format = "%.80s experimental free-threading build (%.80s) %.80s";
#else
    const char *buildinfo_format = "%.80s (%.80s) %.80s";
#endif
    PyOS_snprintf(version, sizeof(version), buildinfo_format,
                  PY_VERSION, Py_GetBuildInfo(), Py_GetCompiler());
}

```

We can rearrange it to use literal format strings

```c
void _Py_InitVersion(void)
{
    if (initialized) {
        return;
    }
    initialized = 1;
#ifdef Py_GIL_DISABLED
    PyOS_snprintf(version, sizeof(version), "%.80s experimental free-threading build (%.80s) %.80s",
                   PY_VERSION, Py_GetBuildInfo(), Py_GetCompiler());
#else
    PyOS_snprintf(version, sizeof(version), "%.80s (%.80s) %.80s",
                   PY_VERSION, Py_GetBuildInfo(), Py_GetCompiler());
#endif
}
```

Granted this is probably one of the simplest fixes in CPython we are likely to encounter. However in the same PR there is an example in `unicodeobject.c` using `#pragma`s to suppress warnings within the source along with an explanation about why this warning can be ignored

```c
@@ -2851,6 +2851,14 @@ unicode_fromformat_arg(_PyUnicodeWriter *writer,
         // Format strings for sprintf are selected from constant arrays of
         // constant strings, and the variable used to index into the arrays
         // is only assigned known constant values. Ignore warnings related
         // to the format string not being a string literal.
         #if defined(__GNUC__) || defined(__clang__)
         #pragma GCC diagnostic push
          #pragma GCC diagnostic ignored "-Wformat-nonliteral"
         #endif
         switch (sizemod) {
             case F_LONG:
                 len = issigned ?

@@ -2881,6 +2889,9 @@ unicode_fromformat_arg(_PyUnicodeWriter *writer,

                     sprintf(buffer, fmt, va_arg(*vargs, unsigned int));
                 break;
         }
         #if defined(__GNUC__) || defined(__clang__)
         #pragma GCC diagnostic pop
         #endif
```

I am not convinced that this is the best route to take, however, because if a developer were to introduce a change within the `#pragma` block that introduced a new warning, potentially one with a real vulnerability, it would not be caught by the new warning checking tooling. By forgoing ignoring the warning at the source code level the warnings generated in this block could be included in the warning ignore file by their count and new warnings would be caught prior to merging to main.

The above examples are meant to spur conversation when we move to tackle the large warning backlog.

I have also considered looking into MSVC compiler options as well as including the warning check tooling into a Windows GitHub Actions workflow. The OpenSSF guidance focuses on options available using gcc and clang maybe new guidance could be created inspired by the existing guidance, or it could be discussed with the OpenSSF Memory Safety Special Interest Group the possibility of adding MSVC options to the existing guidance.

### Tooling Improvements

There are a couple ways to improve the tooling itself. One that has been discussed is being able to ignore entire files completely regardless of the number of warnings or to ignore entire directories and their subdirectories. There are many files within CPython relating to testing or generating test cases that we don’t need to consider for the intent of this project. Contributing to testing and testing infrastructure should not be burdened by having to add entries to the warning ignore files.

Tracking warnings at any smaller granularity than the number of warnings per file would be difficult since tracking individual warnings would require a comprehensive list of all ignored warnings in the warning ignore files.. As line numbers for warnings change, even from changes unrelated to the warning, developers would have to verify that the warnings with new line numbers or display columns correspond to the already existing warnings ignored or else new more complex tooling would need to be developed. A middle ground between that extreme and where we are now is to ignore warnings per warning type and file. Developers could easily see the types of warnings they are introducing per file, and potentially help them prioritize which should be refactored and which can safely be ignored.

# Acknowledgements

- [Seth Larson](https://github.com/sethmlarson) - My sherpa for bringing me on board the CPython project. Thank you for the guidance and work you have done to make this such an enjoyable entry into contributing to CPython
- [Hugo van Kemenade](https://github.com/hugovk) & [Donghee Na](https://github.com/corona10) - With a million things going on within CPython they were always expedient and helpful with comments and suggestions on pull requests.
- [Michael Droettboom](https://github.com/mdboom) - First proposed this project and kicked off countless benchmarks for me which proved to be immeasurably helpful.